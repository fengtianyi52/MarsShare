package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims holds the custom JWT claims for access tokens.
type Claims struct {
	UserID string `json:"uid"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

// TokenManager handles JWT access tokens and opaque refresh tokens.
type TokenManager struct {
	secret []byte
}

// NewTokenManager creates a TokenManager using the master key hash bytes for signing.
func NewTokenManager(masterKeyHash []byte) *TokenManager {
	return &TokenManager{secret: masterKeyHash}
}

// GenerateAccessToken creates a signed JWT access token with 15-minute expiry.
func (m *TokenManager) GenerateAccessToken(userID, role string) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
}

// ValidateAccessToken parses and validates a JWT string, returning the claims.
func (m *TokenManager) ValidateAccessToken(tokenStr string) (*Claims, error) {
	parsed, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return nil, fmt.Errorf("invalid access token")
	}
	return claims, nil
}

// GenerateRefreshToken returns (rawToken, hashedToken, error).
// The raw token is a random 32-byte hex string; the hash is SHA-256 of the raw token.
func (m *TokenManager) GenerateRefreshToken() (string, string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	raw := hex.EncodeToString(buf)
	hashed := HashToken(raw)
	return raw, hashed, nil
}

// HashToken computes the SHA-256 hex digest of a token string.
func HashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
