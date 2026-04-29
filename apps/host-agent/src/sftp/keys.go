package sftp

import (
	"fmt"

	gossh "golang.org/x/crypto/ssh"
)

var allowedKeyTypes = map[string]bool{
	"ssh-ed25519":             true,
	"ecdsa-sha2-nistp256":     true,
	"ecdsa-sha2-nistp384":     true,
	"ecdsa-sha2-nistp521":     true,
	"ssh-rsa":                 true,
}

func ValidatePublicKey(keyLine string) error {
	pub, _, _, _, err := gossh.ParseAuthorizedKey([]byte(keyLine))
	if err != nil {
		return fmt.Errorf("invalid SSH public key: %w", err)
	}
	if !allowedKeyTypes[pub.Type()] {
		return fmt.Errorf("unsupported key type: %s", pub.Type())
	}
	return nil
}
