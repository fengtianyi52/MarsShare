package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Handler is the interface each storage backend must implement.
type Handler interface {
	Put(ctx context.Context, key string, reader io.Reader, size int64) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, keys []string) error
	Source(ctx context.Context, key string, expires time.Duration) (string, error)
}

// Capabilities describes what a storage backend supports.
type Capabilities struct {
	DirectURL     bool
	ProxyRequired bool
	MaxFileSize   int64
}

// Manager maps policy IDs to storage handlers and dispatches operations.
type Manager struct {
	handlers map[string]Handler
	mu       sync.RWMutex
}

// NewManager creates an empty Manager.
func NewManager() *Manager {
	return &Manager{
		handlers: make(map[string]Handler),
	}
}

// RegisterPolicy associates a storage handler with a policy ID.
// If a handler was already registered for this policy, it is replaced.
func (m *Manager) RegisterPolicy(policyID string, h Handler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.handlers[policyID] = h
}

// UnregisterPolicy removes the handler associated with a policy ID.
// No-op if no handler is registered.
func (m *Manager) UnregisterPolicy(policyID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.handlers, policyID)
}

// GetHandler returns the handler for a given policy, or an error if not found.
func (m *Manager) GetHandler(policyID string) (Handler, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	h, ok := m.handlers[policyID]
	if !ok {
		return nil, fmt.Errorf("no storage handler registered for policy %q", policyID)
	}
	return h, nil
}

// Put writes an object to the storage backend for the given policy.
func (m *Manager) Put(ctx context.Context, policyID, key string, r io.Reader, size int64) error {
	h, err := m.GetHandler(policyID)
	if err != nil {
		return err
	}
	return h.Put(ctx, key, r, size)
}

// Get reads an object from the storage backend for the given policy.
func (m *Manager) Get(ctx context.Context, policyID, key string) (io.ReadCloser, error) {
	h, err := m.GetHandler(policyID)
	if err != nil {
		return nil, err
	}
	return h.Get(ctx, key)
}

// Delete removes objects from the storage backend for the given policy.
func (m *Manager) Delete(ctx context.Context, policyID string, keys []string) error {
	h, err := m.GetHandler(policyID)
	if err != nil {
		return err
	}
	return h.Delete(ctx, keys)
}

// Source returns a direct/signed URL for accessing the object, if supported.
func (m *Manager) Source(ctx context.Context, policyID, key string, expires time.Duration) (string, error) {
	h, err := m.GetHandler(policyID)
	if err != nil {
		return "", err
	}
	return h.Source(ctx, key, expires)
}

// ErrUnsupportedBackend is returned when a storage policy type is not recognized.
var ErrUnsupportedBackend = fmt.Errorf("unsupported storage backend type")

// NewHandler creates a storage Handler from a policy's configuration.
//
// All cloud storage types (s3, oss, cos, qiniu, upyun) use the S3-compatible
// protocol since all major Chinese cloud providers expose S3-compatible endpoints:
//   - Alibaba Cloud OSS: endpoint = https://oss-<region>.aliyuncs.com
//   - Tencent Cloud COS: endpoint = https://cos.<region>.myqcloud.com
//   - Qiniu Cloud Kodo:  endpoint = https://s3-<region>.qiniucs.com
//   - Upyun:             endpoint = https://s3.upyun.com (limited S3 support)
func NewHandler(policyType, endpoint, region, bucket, accessKey, secretKey, localPath string) (Handler, error) {
	switch policyType {
	case "local":
		return NewLocal(localPath)
	case "s3", "oss", "cos", "qiniu", "upyun":
		return NewS3(endpoint, region, bucket, accessKey, secretKey)
	default:
		return nil, ErrUnsupportedBackend
	}
}

// GenerateKey builds an object key from policy naming rules.
//
// Supported placeholders:
//   - {uid}      -> userID
//   - {date}     -> current date as 2006/01/02
//   - {random}   -> 8-char hex random string
//   - {ext}      -> file extension including dot (e.g. ".jpg")
//   - {original} -> sanitized original filename without extension
//   - {uuid}     -> new UUID v4
func GenerateKey(dirRule, fileRule, userID, originalName string) string {
	now := time.Now()
	ext := path.Ext(originalName)
	base := strings.TrimSuffix(originalName, ext)
	base = sanitizeFilename(base)
	if base == "" {
		base = "file"
	}

	randomBytes := make([]byte, 4)
	_, _ = rand.Read(randomBytes)
	randomHex := hex.EncodeToString(randomBytes)

	replacer := strings.NewReplacer(
		"{uid}", userID,
		"{date}", now.Format("2006/01/02"),
		"{random}", randomHex,
		"{ext}", ext,
		"{original}", base,
		"{uuid}", uuid.NewString(),
	)

	dir := replacer.Replace(dirRule)
	file := replacer.Replace(fileRule)

	if dir == "" {
		return file
	}
	return strings.TrimRight(dir, "/") + "/" + file
}

// sanitizeFilename removes characters that are unsafe in file paths.
func sanitizeFilename(name string) string {
	name = strings.ToLower(name)
	name = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			return r
		}
		return '-'
	}, name)
	// Collapse multiple dashes
	for strings.Contains(name, "--") {
		name = strings.ReplaceAll(name, "--", "-")
	}
	return strings.Trim(name, "-")
}
