package store

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"regexp"
	"strings"

	"github.com/mozillazg/go-pinyin"
)

var (
	validUsernameRE = regexp.MustCompile(`^[a-z][a-z0-9_]{1,29}$`)
	pinyinArgs      = func() pinyin.Args {
		a := pinyin.NewArgs()
		a.Style = pinyin.FirstLetter
		return a
	}()
)

// sanitizeUsername converts an arbitrary string into a valid username that
// satisfies ^[a-z][a-z0-9_]{1,29}$.
//
// Transformation rules (applied per rune):
//   - CJK Unified Ideographs (中文) → first letter of Mandarin pinyin initial
//   - space / tab                   → underscore
//   - uppercase letter              → lowercase
//   - [a-z0-9_]                     → kept as-is
//   - everything else               → removed
//
// If any Chinese characters were present the result gets 4 random digits
// appended (before truncation) to reduce collision probability.
// If the final string doesn't start with [a-z], 'u' is prepended.
// Truncated to 30 characters.  If still empty, returns "u" + 4 random digits.
func sanitizeUsername(original string) string {
	var buf strings.Builder
	hasChinese := false

	for _, r := range original {
		switch {
		case r >= '\u4e00' && r <= '\u9fff':
			// CJK Unified Ideographs – take pinyin first letter
			hasChinese = true
			py := pinyin.SinglePinyin(r, pinyinArgs)
			if len(py) > 0 && len(py[0]) > 0 {
				buf.WriteByte(py[0][0])
			}

		case r >= '\u3400' && r <= '\u4dbf',
			r >= 0x20000 && r <= 0x2a6df,
			r >= 0x2a700 && r <= 0x2ceaf:
			// Extended CJK blocks – take pinyin first letter if available,
			// otherwise skip (pinyin lib may return empty for rare chars)
			hasChinese = true
			py := pinyin.SinglePinyin(r, pinyinArgs)
			if len(py) > 0 && len(py[0]) > 0 {
				buf.WriteByte(py[0][0])
			}

		case r == ' ' || r == '\t':
			buf.WriteByte('_')

		case r >= 'A' && r <= 'Z':
			buf.WriteByte(byte(r + 32)) // to lowercase

		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_':
			buf.WriteRune(r)

		// all other characters (symbols, emoji, etc.) are silently dropped
		}
	}

	result := buf.String()

	if hasChinese {
		result += fmt.Sprintf("%04d", rand.Intn(10000))
	}

	// Must start with a letter
	if len(result) == 0 || result[0] < 'a' || result[0] > 'z' {
		result = "u" + result
	}

	// Truncate to 30 characters
	if len([]rune(result)) > 30 {
		result = string([]rune(result)[:30])
	}

	// Degenerate case: only 'u' with no suffix – add random digits
	if len(result) < 2 {
		result = fmt.Sprintf("u%04d", rand.Intn(10000))
	}

	return result
}

// FixInvalidUsernames scans all users and renames any whose username does not
// satisfy ^[a-z][a-z0-9_]{1,29}$.  It is called once on startup; because the
// renamed usernames now pass validation the function is a no-op on subsequent
// starts unless new invalid rows somehow appear.
func (s *Store) FixInvalidUsernames(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT id, username FROM users`)
	if err != nil {
		return fmt.Errorf("username_fix: query users: %w", err)
	}
	defer rows.Close()

	type row struct{ id, username string }
	var toFix []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.username); err != nil {
			return fmt.Errorf("username_fix: scan: %w", err)
		}
		if !validUsernameRE.MatchString(r.username) {
			toFix = append(toFix, r)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("username_fix: rows: %w", err)
	}

	if len(toFix) == 0 {
		return nil
	}

	log.Printf("username_fix: found %d user(s) with invalid usernames", len(toFix))

	for _, u := range toFix {
		newName := sanitizeUsername(u.username)

		// Resolve uniqueness conflicts by re-rolling the random suffix
		for attempt := 0; attempt < 100; attempt++ {
			var exists bool
			err := s.pool.QueryRow(ctx,
				`SELECT EXISTS(SELECT 1 FROM users WHERE username = $1 AND id != $2)`,
				newName, u.id,
			).Scan(&exists)
			if err != nil {
				log.Printf("username_fix: uniqueness check failed for %q: %v", newName, err)
				break
			}
			if !exists {
				break
			}
			// Collision: regenerate with a fresh random component
			if attempt < 99 {
				newName = sanitizeUsername(u.username)
			} else {
				// Last-resort fallback: fully random name
				newName = fmt.Sprintf("u%04d%04d", rand.Intn(10000), rand.Intn(10000))
			}
		}

		_, err := s.pool.Exec(ctx,
			`UPDATE users SET username = $1 WHERE id = $2`,
			newName, u.id,
		)
		if err != nil {
			log.Printf("username_fix: failed to rename %q → %q (id=%s): %v", u.username, newName, u.id, err)
			continue
		}
		log.Printf("username_fix: renamed %q → %q", u.username, newName)
	}

	return nil
}
