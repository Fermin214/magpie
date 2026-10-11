package favorites

import (
	"context"
	"os"
	"path/filepath"
	"time"
)

func (s Store) lock(ctx context.Context) (func(), error) {
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return nil, &Fault{"storage", err}
	}
	f, err := os.OpenFile(filepath.Join(s.Dir, "favorites.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, &Fault{"storage", err}
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	for {
		ok, err := tryLock(f)
		if err != nil {
			f.Close()
			return nil, &Fault{"storage", err}
		}
		if ok {
			return func() { unlockFile(f); f.Close() }, nil
		}
		select {
		case <-ctx.Done():
			f.Close()
			return nil, fault("busy", "Favorites are being saved by another process.")
		case <-time.After(30 * time.Millisecond):
		}
	}
}
