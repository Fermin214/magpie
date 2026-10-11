package favorites

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func rev(v uint64) *uint64 { return &v }
func code(t *testing.T, err error, want string) {
	t.Helper()
	var f *Fault
	if !errors.As(err, &f) || f.Code != want {
		t.Fatalf("want %s, got %v", want, err)
	}
}
func TestSaveConflictBackupAndReopen(t *testing.T) {
	s := Store{t.TempDir()}
	ctx := context.Background()
	first, err := s.Save(ctx, Change{Revision: rev(0), Kind: "prompt", Prompt: &Prompt{Title: "Game notes", Body: "  exact text\n", Tags: []string{" SQL ", "sql", "Game"}}})
	if err != nil {
		t.Fatal(err)
	}
	if first.Revision != 1 || len(first.Prompts) != 1 || first.Prompts[0].Body != "  exact text\n" || len(first.Prompts[0].Tags) != 2 {
		t.Fatalf("%+v", first)
	}
	raw, _ := os.ReadFile(s.path())
	_, err = s.Save(ctx, Change{Revision: rev(0), Kind: "repository", Repository: &Repository{Name: "Tools", URL: "https://github.com/example/tools", Status: "interested"}})
	code(t, err, "conflict")
	if got, _ := os.ReadFile(s.path()); !bytes.Equal(got, raw) {
		t.Fatal("stale save changed data")
	}
	second, err := s.Save(ctx, Change{Revision: rev(1), Kind: "repository", Repository: &Repository{Name: "Tools", URL: "https://github.com/example/tools", Status: "in_use"}})
	if err != nil {
		t.Fatal(err)
	}
	backup, _ := os.ReadFile(s.path() + ".bak")
	if !bytes.Equal(backup, raw) {
		t.Fatal("backup isn't the prior good document")
	}
	reopened, err := (Store{s.Dir}).Load()
	if err != nil || len(reopened.Prompts) != 1 || len(reopened.Repositories) != 1 || reopened.Revision != second.Revision {
		t.Fatalf("%+v %v", reopened, err)
	}
	_, err = s.Save(ctx, Change{Revision: rev(2), Kind: "repository", Repository: &Repository{Name: "Duplicate", URL: "http://github.com/EXAMPLE/TOOLS.git?x=1", Status: "interested"}})
	code(t, err, "duplicate")
	p := first.Prompts[0]
	p.Title = "Edited"
	third, err := s.Save(ctx, Change{Revision: rev(2), Kind: "prompt", Prompt: &p})
	if err != nil || third.Repositories[0].Status != "in_use" || third.Prompts[0].CreatedAt != p.CreatedAt {
		t.Fatalf("unrelated fields lost: %+v %v", third, err)
	}
}
func TestInvalidReadAndFailedBackupPreserveData(t *testing.T) {
	for _, raw := range []string{"", "{", "{}", `{"schemaVersion":99,"prompts":[],"repositories":[]}`, `{"schemaVersion":1,"revision":1,"prompts":[],"repositories":[],"newField":true}`} {
		t.Run(raw, func(t *testing.T) {
			s := Store{t.TempDir()}
			os.WriteFile(s.path(), []byte(raw), 0600)
			if _, err := s.Load(); err == nil {
				t.Fatal("bad data read as empty")
			}
			if _, err := s.Save(context.Background(), Change{Revision: rev(0), Kind: "prompt", Prompt: &Prompt{Title: "overwrite"}}); err == nil {
				t.Fatal("bad data overwritten")
			}
			got, _ := os.ReadFile(s.path())
			if string(got) != raw {
				t.Fatal("original changed")
			}
		})
	}
	s := Store{t.TempDir()}
	first, err := s.Save(context.Background(), Change{Revision: rev(0), Kind: "prompt", Prompt: &Prompt{Title: "Keep"}})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(s.path())
	os.Mkdir(s.path()+".bak", 0700)
	_, err = s.Delete(context.Background(), Change{Revision: rev(first.Revision), Kind: "prompt", ID: first.Prompts[0].ID})
	if err == nil {
		t.Fatal("backup failure ignored")
	}
	got, _ := os.ReadFile(s.path())
	if !bytes.Equal(raw, got) {
		t.Fatal("failed save changed primary")
	}
}
func TestConcurrentStoresDoNotLoseWrites(t *testing.T) {
	dir := t.TempDir()
	var wg sync.WaitGroup
	out := make(chan error, 2)
	for _, title := range []string{"A", "B"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := (Store{dir}).Save(context.Background(), Change{Revision: rev(0), Kind: "prompt", Prompt: &Prompt{Title: title}})
			out <- err
		}()
	}
	wg.Wait()
	close(out)
	ok, bad := 0, 0
	for err := range out {
		if err == nil {
			ok++
		} else {
			code(t, err, "conflict")
			bad++
		}
	}
	if ok != 1 || bad != 1 {
		t.Fatalf("success=%d conflict=%d", ok, bad)
	}
}
func TestImportPreviewIsReadOnlyAndCommitRevalidates(t *testing.T) {
	s := Store{filepath.Join(t.TempDir(), "not-created")}
	// AgentHub's real prompts.export JSON shape.
	raw := []byte(`[{"id":"legacy-id","title":"My prompt","body":"# Text","purpose":"Review","category":"Work","tags":["SQL"],"favorite":true,"createdAt":"2026-09-01T00:00:00Z","updatedAt":"2026-09-02T00:00:00Z"}]`)
	p, err := s.Preview(raw)
	if err != nil || p.Added != 1 {
		t.Fatalf("%+v %v", p, err)
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("preview wrote files")
	}
	one, err := s.Import(context.Background(), rev(p.Revision), raw)
	if err != nil {
		t.Fatal(err)
	}
	if one.Prompts[0].Purpose != "Review" || one.Prompts[0].CreatedAt != "2026-09-01T00:00:00Z" {
		t.Fatal("legacy metadata lost")
	}
	p, err = s.Preview(raw)
	if err != nil || p.Added != 0 || p.Skipped != 1 {
		t.Fatalf("%+v %v", p, err)
	}
	if _, err = s.Import(context.Background(), rev(0), raw); err == nil {
		t.Fatal("stale preview committed")
	}
	exported, _ := json.Marshal(one)
	other := Store{t.TempDir()}
	if _, err := other.Import(context.Background(), rev(0), exported); err != nil {
		t.Fatal(err)
	}
	bad := []byte(`{"schemaVersion":1,"prompts":[],"repositories":[{"id":"r","name":"Bad","url":"https://user:password@example.com/repo","status":"interested","tags":[]}]}`)
	if _, err := s.Preview(bad); err == nil {
		t.Fatal("credential URL accepted")
	}
}

func TestImportRequiresAnExplicitEnvelopeVersion(t *testing.T) {
	for _, raw := range []string{`null`, `{}`, `{"prompts":[]}`, `{"schemaVersion":2,"prompts":[]}`} {
		if _, err := ParseImport([]byte(raw)); err == nil {
			t.Fatalf("accepted unversioned or unsupported envelope: %s", raw)
		}
	}
}
