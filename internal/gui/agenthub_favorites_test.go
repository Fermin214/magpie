package gui

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/agenthub/favorites"
	"github.com/yetone/magpie/internal/settings"
)

func TestAgentHubFavoritesRoundTrip(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	h := Handler(nil, nil)
	call := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(method, path, strings.NewReader(body)))
		return w
	}
	read := call("GET", "/api/agenthub/favorites", "")
	if read.Code != 200 {
		t.Fatalf("favorites route: %d %s", read.Code, read.Body)
	}
	var empty favorites.Snapshot
	if err := json.Unmarshal(read.Body.Bytes(), &empty); err != nil || empty.SchemaVersion != 1 {
		t.Fatalf("%s: %v", read.Body, err)
	}
	saved := call("POST", "/api/agenthub/favorites/save", `{"revision":0,"kind":"prompt","prompt":{"title":"Round trip","body":"exact"}}`)
	if saved.Code != 200 {
		t.Fatalf("%d %s", saved.Code, saved.Body)
	}
	var one favorites.Snapshot
	json.Unmarshal(saved.Body.Bytes(), &one)
	if len(one.Prompts) != 1 {
		t.Fatal(saved.Body)
	}
	stale := call("POST", "/api/agenthub/favorites/save", `{"revision":0,"kind":"prompt","prompt":{"title":"stale"}}`)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale write: %d", stale.Code)
	}
	invalid := call("POST", "/api/agenthub/favorites/save", `{"kind":"prompt","prompt":{"title":"missing revision"}}`)
	if invalid.Code != 400 {
		t.Fatal(invalid.Code)
	}
	if _, err := os.Stat(filepath.Join(settings.Dir(), "library.json")); !os.IsNotExist(err) {
		t.Fatal("favorites touched Library")
	}
	raw, _ := os.ReadFile(filepath.Join(settings.Dir(), "agenthub", "favorites.json"))
	if !bytes.Contains(raw, []byte("Round trip")) {
		t.Fatal("not persisted")
	}
	// Browser management keeps the existing authentication boundary.
	guarded := webGuard("session", "test-key", 0, h)
	w := httptest.NewRecorder()
	guarded.ServeHTTP(w, httptest.NewRequest("GET", "/api/agenthub/favorites", nil))
	if w.Code != 401 {
		t.Fatal("unauthenticated favorites read")
	}
}
