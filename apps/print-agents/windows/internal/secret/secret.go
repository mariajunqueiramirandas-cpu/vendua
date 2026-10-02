// Package secret protects the device token at rest.
package secret

// Protector seals and unseals small secrets for the current OS user.
type Protector interface {
	Protect(plain []byte) ([]byte, error)
	Unprotect(sealed []byte) ([]byte, error)
}

// Plain stores secrets as-is; the file holding them is created 0600.
type Plain struct{}

func (Plain) Protect(b []byte) ([]byte, error)   { return append([]byte(nil), b...), nil }
func (Plain) Unprotect(b []byte) ([]byte, error) { return append([]byte(nil), b...), nil }
