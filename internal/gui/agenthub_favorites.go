package gui

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"

	"github.com/yetone/magpie/internal/agenthub/favorites"
	"github.com/yetone/magpie/internal/settings"
)

// agenthubFavoritesRoutes belongs to the management UI's handler, never the LLM gateway.
func agenthubFavoritesRoutes(mux *http.ServeMux) {
	store := favorites.Store{Dir: filepath.Join(settings.Dir(), "agenthub")}
	respond := func(w http.ResponseWriter, value any, err error) {
		if err == nil {
			writeJSON(w, value)
			return
		}
		code := "storage"
		var fault *favorites.Fault
		if errors.As(err, &fault) {
			code = fault.Code
		}
		status := http.StatusBadRequest
		switch code {
		case "conflict", "duplicate":
			status = http.StatusConflict
		case "missing":
			status = http.StatusNotFound
		case "storage", "corrupt", "version", "busy":
			status = http.StatusServiceUnavailable
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"code": code, "error": err.Error()})
	}
	read := func(w http.ResponseWriter, r *http.Request, v any) bool {
		r.Body = http.MaxBytesReader(w, r.Body, favorites.MaxBytes+4096)
		d := json.NewDecoder(r.Body)
		d.DisallowUnknownFields()
		if err := d.Decode(v); err != nil {
			respond(w, nil, &favorites.Fault{Code: "invalid", Err: err})
			return false
		}
		if err := d.Decode(new(any)); err != io.EOF {
			respond(w, nil, &favorites.Fault{Code: "invalid", Err: errors.New("unexpected trailing JSON")})
			return false
		}
		return true
	}
	mux.HandleFunc("GET /api/agenthub/favorites", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		doc, err := store.Load()
		respond(w, doc, err)
	})
	for _, entry := range []struct {
		path string
		run  func(context.Context, favorites.Change) (favorites.Snapshot, error)
	}{{"save", store.Save}, {"delete", store.Delete}} {
		mux.HandleFunc("POST /api/agenthub/favorites/"+entry.path, func(w http.ResponseWriter, r *http.Request) {
			var in favorites.Change
			if !read(w, r, &in) {
				return
			}
			doc, err := entry.run(r.Context(), in)
			respond(w, doc, err)
		})
	}
	mux.HandleFunc("POST /api/agenthub/favorites/import/preview", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Data json.RawMessage `json:"data"`
		}
		if !read(w, r, &in) {
			return
		}
		p, err := store.Preview(in.Data)
		respond(w, p, err)
	})
	mux.HandleFunc("POST /api/agenthub/favorites/import", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Data     json.RawMessage `json:"data"`
			Revision *uint64         `json:"revision"`
		}
		if !read(w, r, &in) {
			return
		}
		doc, err := store.Import(r.Context(), in.Revision, in.Data)
		respond(w, doc, err)
	})
}
