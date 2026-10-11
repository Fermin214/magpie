// Package favorites stores personal text and repository bookmarks independently
// of magpie's Library and agent configuration.
package favorites

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/steady"
)

const SchemaVersion = 1
const MaxBytes = 16 << 20

type Prompt struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	Purpose   string   `json:"purpose"`
	Category  string   `json:"category"`
	Tags      []string `json:"tags"`
	Favorite  bool     `json:"favorite"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
}

type Repository struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	URL      string   `json:"url"`
	Notes    string   `json:"notes"`
	Tags     []string `json:"tags"`
	Status   string   `json:"status"`
	Archived bool     `json:"archived"`
	// ProjectID preserves an AgentHub import's provenance; it has no runtime meaning.
	ProjectID string `json:"projectId,omitempty"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type Snapshot struct {
	SchemaVersion int          `json:"schemaVersion"`
	Revision      uint64       `json:"revision"`
	Prompts       []Prompt     `json:"prompts"`
	Repositories  []Repository `json:"repositories"`
}

type Fault struct {
	Code string
	Err  error
}

func (e *Fault) Error() string         { return e.Err.Error() }
func (e *Fault) Unwrap() error         { return e.Err }
func fault(code, message string) error { return &Fault{code, errors.New(message)} }

type Store struct{ Dir string }

func empty() Snapshot {
	return Snapshot{SchemaVersion: SchemaVersion, Prompts: []Prompt{}, Repositories: []Repository{}}
}
func (s Store) path() string { return filepath.Join(s.Dir, "favorites.json") }

// Load never repairs or creates a file. Unreadable or newer data is not empty data.
func (s Store) Load() (Snapshot, error) {
	doc, _, err := s.read()
	return doc, err
}
func (s Store) read() (Snapshot, []byte, error) {
	f, err := os.Open(s.path())
	if errors.Is(err, os.ErrNotExist) {
		return empty(), nil, nil
	}
	if err != nil {
		return Snapshot{}, nil, &Fault{"storage", err}
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, MaxBytes+1))
	if err != nil {
		return Snapshot{}, nil, &Fault{"storage", err}
	}
	var doc Snapshot
	if len(raw) > MaxBytes || decode(raw, &doc) != nil {
		return Snapshot{}, nil, fault("corrupt", "The favorites file could not be read.")
	}
	if doc.SchemaVersion != SchemaVersion {
		return Snapshot{}, nil, fault("version", "This favorites format needs a newer build.")
	}
	if err := validate(&doc); err != nil {
		return Snapshot{}, nil, &Fault{"corrupt", err}
	}
	return doc, raw, nil
}
func decode(raw []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return errors.New("unexpected trailing JSON")
	}
	return nil
}
func validID(id string) bool {
	if len(id) == 0 || len(id) > 100 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
func newID() string { b := make([]byte, 16); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func tags(in []string) ([]string, error) {
	if len(in) > 50 {
		return nil, fault("invalid", "Too many tags.")
	}
	out := []string{}
	seen := map[string]bool{}
	for _, tag := range in {
		tag = strings.TrimSpace(tag)
		if len(tag) > 128 {
			return nil, fault("invalid", "A tag is too long.")
		}
		k := strings.ToLower(tag)
		if tag != "" && !seen[k] {
			seen[k] = true
			out = append(out, tag)
		}
	}
	return out, nil
}
func dates(created, updated string) bool {
	for _, d := range []string{created, updated} {
		if _, err := time.Parse(time.RFC3339Nano, d); err != nil {
			return false
		}
	}
	return true
}
func URLKey(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || len(raw) > 4096 {
		return "", fault("invalid", "Use an HTTP(S) repository URL without credentials.")
	}
	u.Scheme = "https"
	u.Host = strings.ToLower(u.Host)
	u.RawQuery = ""
	u.Fragment = ""
	u.RawPath = ""
	u.Path = strings.TrimSuffix(strings.TrimRight(u.Path, "/"), ".git")
	if u.Hostname() == "github.com" {
		u.Path = strings.ToLower(u.Path)
	}
	return u.String(), nil
}
func validate(doc *Snapshot) error {
	if len(doc.Prompts)+len(doc.Repositories) > 20000 {
		return fault("invalid", "Too many favorites.")
	}
	ids := map[string]bool{}
	for i := range doc.Prompts {
		p := &doc.Prompts[i]
		p.Title = strings.TrimSpace(p.Title)
		if !validID(p.ID) || ids[p.ID] || p.Title == "" || len(p.Title) > 512 || len(p.Body) > 1<<20 || len(p.Purpose) > 20000 || len(p.Category) > 128 || !dates(p.CreatedAt, p.UpdatedAt) {
			return fault("invalid", "Invalid prompt fields.")
		}
		ids[p.ID] = true
		var err error
		p.Tags, err = tags(p.Tags)
		if err != nil {
			return err
		}
	}
	ids = map[string]bool{}
	urls := map[string]bool{}
	for i := range doc.Repositories {
		r := &doc.Repositories[i]
		r.Name = strings.TrimSpace(r.Name)
		r.URL = strings.TrimSpace(r.URL)
		key, err := URLKey(r.URL)
		if err != nil {
			return err
		}
		if !validID(r.ID) || ids[r.ID] || urls[key] || r.Name == "" || len(r.Name) > 512 || len(r.Notes) > 20000 || len(r.ProjectID) > 100 || !dates(r.CreatedAt, r.UpdatedAt) {
			return fault("invalid", "Invalid or duplicate repository fields.")
		}
		if r.Status != "interested" && r.Status != "in_use" && r.Status != "uninstalled" {
			return fault("invalid", "Invalid repository status.")
		}
		ids[r.ID] = true
		urls[key] = true
		r.Tags, err = tags(r.Tags)
		if err != nil {
			return err
		}
	}
	if doc.Prompts == nil {
		doc.Prompts = []Prompt{}
	}
	if doc.Repositories == nil {
		doc.Repositories = []Repository{}
	}
	return nil
}

type Change struct {
	Revision   *uint64     `json:"revision"`
	Kind       string      `json:"kind"`
	ID         string      `json:"id,omitempty"`
	Prompt     *Prompt     `json:"prompt,omitempty"`
	Repository *Repository `json:"repository,omitempty"`
}

func (s Store) mutate(ctx context.Context, revision *uint64, fn func(*Snapshot) error) (Snapshot, error) {
	if revision == nil {
		return Snapshot{}, fault("invalid", "A data revision is required.")
	}
	unlock, err := s.lock(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	defer unlock()
	doc, old, err := s.read()
	if err != nil {
		return Snapshot{}, err
	}
	if *revision != doc.Revision {
		return Snapshot{}, fault("conflict", "Favorites changed in another window. Reload before saving.")
	}
	if err = fn(&doc); err != nil {
		return Snapshot{}, err
	}
	if err = validate(&doc); err != nil {
		return Snapshot{}, err
	}
	if doc.Revision == ^uint64(0) {
		return Snapshot{}, fault("version", "The data revision is exhausted.")
	}
	doc.Revision++
	raw, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return Snapshot{}, err
	}
	if len(raw)+1 > MaxBytes {
		return Snapshot{}, fault("invalid", "Favorites exceed the file size limit.")
	}
	// The backup must succeed before the last good primary is replaced.
	if old != nil {
		if err = atomicWrite(s.path()+".bak", old); err != nil {
			return Snapshot{}, &Fault{"storage", err}
		}
	}
	if err = atomicWrite(s.path(), append(raw, '\n')); err != nil {
		return Snapshot{}, &Fault{"storage", err}
	}
	return doc, nil
}
func (s Store) Save(ctx context.Context, in Change) (Snapshot, error) {
	return s.mutate(ctx, in.Revision, func(doc *Snapshot) error {
		now := time.Now().UTC().Format(time.RFC3339Nano)
		switch in.Kind {
		case "prompt":
			if in.Prompt == nil {
				return fault("invalid", "A prompt is required.")
			}
			p := *in.Prompt
			if p.ID == "" {
				p.ID = newID()
				p.CreatedAt = now
				p.UpdatedAt = now
				doc.Prompts = append(doc.Prompts, p)
				return nil
			}
			for i, old := range doc.Prompts {
				if old.ID == p.ID {
					p.CreatedAt = old.CreatedAt
					p.UpdatedAt = now
					doc.Prompts[i] = p
					return nil
				}
			}
		case "repository":
			if in.Repository == nil {
				return fault("invalid", "A repository is required.")
			}
			r := *in.Repository
			for _, old := range doc.Repositories {
				a, _ := URLKey(old.URL)
				b, err := URLKey(r.URL)
				if err != nil {
					return err
				}
				if old.ID != r.ID && a == b {
					return fault("duplicate", "This repository is already saved.")
				}
			}
			if r.ID == "" {
				r.ID = newID()
				r.CreatedAt = now
				r.UpdatedAt = now
				doc.Repositories = append(doc.Repositories, r)
				return nil
			}
			for i, old := range doc.Repositories {
				if old.ID == r.ID {
					r.CreatedAt = old.CreatedAt
					r.UpdatedAt = now
					r.ProjectID = old.ProjectID
					doc.Repositories[i] = r
					return nil
				}
			}
		default:
			return fault("invalid", "Unknown favorite kind.")
		}
		return fault("missing", "The favorite no longer exists.")
	})
}
func (s Store) Delete(ctx context.Context, in Change) (Snapshot, error) {
	return s.mutate(ctx, in.Revision, func(doc *Snapshot) error {
		switch in.Kind {
		case "prompt":
			for i, p := range doc.Prompts {
				if p.ID == in.ID {
					doc.Prompts = append(doc.Prompts[:i], doc.Prompts[i+1:]...)
					return nil
				}
			}
		case "repository":
			for i, r := range doc.Repositories {
				if r.ID == in.ID {
					doc.Repositories = append(doc.Repositories[:i], doc.Repositories[i+1:]...)
					return nil
				}
			}
		default:
			return fault("invalid", "Unknown favorite kind.")
		}
		return fault("missing", "The favorite no longer exists.")
	})
}

type Preview struct {
	Added     int      `json:"added"`
	Skipped   int      `json:"skipped"`
	Conflicts []string `json:"conflicts"`
	Revision  uint64   `json:"revision"`
}

func ParseImport(raw []byte) (Snapshot, error) {
	raw = bytes.TrimSpace(raw)
	doc := empty()
	if len(raw) == 0 || len(raw) > MaxBytes {
		return doc, fault("invalid", "Invalid import size.")
	}
	var err error
	if raw[0] == '[' {
		err = decode(raw, &doc.Prompts)
	} else {
		doc = Snapshot{} // An envelope must explicitly name its format.
		err = decode(raw, &doc)
	}
	if err != nil {
		return doc, &Fault{"invalid", err}
	}
	if doc.SchemaVersion != SchemaVersion {
		return doc, fault("version", "This import format is not supported.")
	}
	// Missing legacy ids and dates are stable across preview, retry and later imports.
	for i := range doc.Prompts {
		p := &doc.Prompts[i]
		if p.ID == "" {
			h := sha256.Sum256([]byte(p.Title + "\x00" + p.Body))
			p.ID = hex.EncodeToString(h[:16])
		}
		importDates(&p.CreatedAt, &p.UpdatedAt)
	}
	for i := range doc.Repositories {
		r := &doc.Repositories[i]
		if r.ID == "" {
			k, e := URLKey(r.URL)
			if e != nil {
				return doc, e
			}
			h := sha256.Sum256([]byte(k))
			r.ID = hex.EncodeToString(h[:16])
		}
		if r.Status == "" {
			r.Status = "interested"
		}
		importDates(&r.CreatedAt, &r.UpdatedAt)
	}
	if err = validate(&doc); err != nil {
		return doc, err
	}
	return doc, nil
}
func importDates(c, u *string) {
	if *c == "" {
		*c = "1970-01-01T00:00:00Z"
	}
	if *u == "" {
		*u = *c
	}
}
func merge(doc *Snapshot, in Snapshot) Preview {
	p := Preview{Conflicts: []string{}, Revision: doc.Revision}
	ids := map[string]bool{}
	urls := map[string]bool{}
	for _, v := range doc.Prompts {
		ids["p"+v.ID] = true
	}
	for _, v := range doc.Repositories {
		ids["r"+v.ID] = true
		k, _ := URLKey(v.URL)
		urls[k] = true
	}
	skip := func(name string) {
		p.Skipped++
		if len(p.Conflicts) < 20 {
			p.Conflicts = append(p.Conflicts, name)
		}
	}
	for _, v := range in.Prompts {
		if ids["p"+v.ID] {
			skip(v.Title)
			continue
		}
		doc.Prompts = append(doc.Prompts, v)
		ids["p"+v.ID] = true
		p.Added++
	}
	for _, v := range in.Repositories {
		k, _ := URLKey(v.URL)
		if ids["r"+v.ID] || urls[k] {
			skip(v.Name)
			continue
		}
		doc.Repositories = append(doc.Repositories, v)
		ids["r"+v.ID] = true
		urls[k] = true
		p.Added++
	}
	return p
}
func (s Store) Preview(raw []byte) (Preview, error) {
	in, err := ParseImport(raw)
	if err != nil {
		return Preview{}, err
	}
	doc, err := s.Load()
	if err != nil {
		return Preview{}, err
	}
	p := merge(&doc, in)
	if err = validate(&doc); err != nil {
		return Preview{}, err
	}
	b, _ := json.MarshalIndent(doc, "", "  ")
	if len(b)+1 > MaxBytes {
		return Preview{}, fault("invalid", "Favorites exceed the file size limit.")
	}
	return p, nil
}
func (s Store) Import(ctx context.Context, revision *uint64, raw []byte) (Snapshot, error) {
	in, err := ParseImport(raw)
	if err != nil {
		return Snapshot{}, err
	}
	return s.mutate(ctx, revision, func(doc *Snapshot) error { merge(doc, in); return nil })
}

// atomicWrite never follows an existing destination symlink or truncates the primary.
func atomicWrite(path string, raw []byte) error {
	if fi, err := os.Lstat(path); err == nil && !fi.Mode().IsRegular() {
		return fmt.Errorf("not a regular favorites file: %s", path)
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".favorites-*.tmp")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(raw); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return steady.Rename(name, path)
}
