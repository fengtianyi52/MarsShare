package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// LocalHandler implements the Handler interface for local disk storage.
type LocalHandler struct {
	basePath string
}

// NewLocal creates a LocalHandler, validating and creating the base directory.
func NewLocal(basePath string) (*LocalHandler, error) {
	abs, err := filepath.Abs(basePath)
	if err != nil {
		return nil, fmt.Errorf("resolve storage path: %w", err)
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, fmt.Errorf("create storage directory: %w", err)
	}
	return &LocalHandler{basePath: abs}, nil
}

// Put writes a file to local disk at the given key path.
func (h *LocalHandler) Put(_ context.Context, key string, r io.Reader, _ int64) error {
	fullPath := filepath.Join(h.basePath, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return fmt.Errorf("create directories: %w", err)
	}
	f, err := os.Create(fullPath)
	if err != nil {
		return fmt.Errorf("create file: %w", err)
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		return fmt.Errorf("write file: %w", err)
	}
	return nil
}

// Get opens a file from local disk and returns a ReadCloser.
func (h *LocalHandler) Get(_ context.Context, key string) (io.ReadCloser, error) {
	fullPath := filepath.Join(h.basePath, filepath.FromSlash(key))
	f, err := os.Open(fullPath)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	return f, nil
}

// Delete removes each of the given keys from local disk.
func (h *LocalHandler) Delete(_ context.Context, keys []string) error {
	for _, key := range keys {
		fullPath := filepath.Join(h.basePath, filepath.FromSlash(key))
		if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("delete %s: %w", key, err)
		}
	}
	return nil
}

// Source returns an error because local storage does not support direct URLs.
func (h *LocalHandler) Source(_ context.Context, _ string, _ time.Duration) (string, error) {
	return "", fmt.Errorf("local storage does not support direct URLs")
}

// BasePath returns the root directory of the local storage.
func (h *LocalHandler) BasePath() string {
	return h.basePath
}
