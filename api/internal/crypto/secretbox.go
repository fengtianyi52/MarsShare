package crypto

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"

	"golang.org/x/crypto/nacl/secretbox"
)

const keySize = 32
const nonceSize = 24

// SecretBox encrypts/decrypts sensitive data using NaCl secretbox.
// The key is derived from APP_MASTER_KEY via SHA-256.
type SecretBox struct {
	key [keySize]byte
}

// NewSecretBox creates a SecretBox with a key derived from the master key string.
func NewSecretBox(masterKey string) (*SecretBox, error) {
	if masterKey == "" {
		return nil, errors.New("master key must not be empty")
	}
	sb := &SecretBox{}
	sb.key = sha256.Sum256([]byte(masterKey))
	return sb, nil
}

// Encrypt encrypts plaintext and returns a base64-encoded string (nonce + ciphertext).
func (sb *SecretBox) Encrypt(plaintext []byte) (string, error) {
	var nonce [nonceSize]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}

	encrypted := secretbox.Seal(nonce[:], plaintext, &nonce, &sb.key)
	return base64.StdEncoding.EncodeToString(encrypted), nil
}

// Decrypt decodes a base64 ciphertext string and returns the plaintext bytes.
func (sb *SecretBox) Decrypt(ciphertext string) ([]byte, error) {
	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, fmt.Errorf("base64 decode: %w", err)
	}
	if len(data) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}

	var nonce [nonceSize]byte
	copy(nonce[:], data[:nonceSize])

	plaintext, ok := secretbox.Open(nil, data[nonceSize:], &nonce, &sb.key)
	if !ok {
		return nil, errors.New("decryption failed")
	}
	return plaintext, nil
}

// EncryptString is a convenience wrapper around Encrypt for string values.
func (sb *SecretBox) EncryptString(value string) (string, error) {
	return sb.Encrypt([]byte(value))
}

// DecryptString is a convenience wrapper around Decrypt that returns a string.
func (sb *SecretBox) DecryptString(ciphertext string) (string, error) {
	plaintext, err := sb.Decrypt(ciphertext)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
