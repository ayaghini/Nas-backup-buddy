package sftp

import (
	"encoding/json"
	"os"
	"path/filepath"

	gossh "golang.org/x/crypto/ssh"

	"github.com/nasbb/host-agent/src/allocation"
)

type Manager struct {
	stateDir string
	reposDir string
}

type userRecord struct {
	Username string `json:"username"`
	AllocID  string `json:"allocId"`
	Active   bool   `json:"active"`
}

func NewManager(stateDir, reposDir string) *Manager {
	return &Manager{stateDir: stateDir, reposDir: reposDir}
}

func (m *Manager) ProvisionUser(alloc *allocation.Allocation) error {
	userDir := filepath.Join(m.stateDir, "users", alloc.Username)
	if err := os.MkdirAll(userDir, 0755); err != nil {
		return err
	}

	rec := userRecord{Username: alloc.Username, AllocID: alloc.AllocID, Active: false}
	if err := writeUserJSON(userDir, rec); err != nil {
		return err
	}

	authKeys := filepath.Join(userDir, "authorized_keys")
	if _, err := os.Stat(authKeys); os.IsNotExist(err) {
		if err := os.WriteFile(authKeys, []byte{}, 0600); err != nil {
			return err
		}
	}

	return m.TriggerReload()
}

func (m *Manager) AuthorizeKey(alloc *allocation.Allocation, publicKey string) error {
	if err := ValidatePublicKey(publicKey); err != nil {
		return err
	}

	userDir := filepath.Join(m.stateDir, "users", alloc.Username)
	if err := os.WriteFile(filepath.Join(userDir, "authorized_keys"), []byte(publicKey+"\n"), 0600); err != nil {
		return err
	}

	rec := userRecord{Username: alloc.Username, AllocID: alloc.AllocID, Active: true}
	if err := writeUserJSON(userDir, rec); err != nil {
		return err
	}

	return m.TriggerReload()
}

func (m *Manager) DeauthorizeKey(username string) error {
	userDir := filepath.Join(m.stateDir, "users", username)

	if err := os.WriteFile(filepath.Join(userDir, "authorized_keys"), []byte{}, 0600); err != nil && !os.IsNotExist(err) {
		return err
	}

	// Update user.json active → false, preserving allocId
	rec, err := readUserJSON(userDir)
	if err == nil {
		rec.Active = false
		writeUserJSON(userDir, rec)
	}

	return m.TriggerReload()
}

func (m *Manager) TriggerReload() error {
	if err := os.MkdirAll(m.stateDir, 0755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(m.stateDir, "reload-trigger"), []byte("1"), 0644)
}

func (m *Manager) GetHostKeyFingerprint() (string, error) {
	return m.readKeyFingerprint("ssh_host_ed25519_key.pub")
}

func (m *Manager) GetRSAHostKeyFingerprint() (string, error) {
	return m.readKeyFingerprint("ssh_host_rsa_key.pub")
}

func (m *Manager) readKeyFingerprint(filename string) (string, error) {
	pubKeyPath := filepath.Join(m.stateDir, "sftp-host-keys", filename)
	data, err := os.ReadFile(pubKeyPath)
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	pub, _, _, _, err := gossh.ParseAuthorizedKey(data)
	if err != nil {
		return "", err
	}
	return gossh.FingerprintSHA256(pub), nil
}

func (m *Manager) ActiveUserCount() int {
	usersDir := filepath.Join(m.stateDir, "users")
	entries, err := os.ReadDir(usersDir)
	if err != nil {
		return 0
	}
	count := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		info, err := os.Stat(filepath.Join(usersDir, e.Name(), "authorized_keys"))
		if err == nil && info.Size() > 0 {
			count++
		}
	}
	return count
}

func writeUserJSON(userDir string, rec userRecord) error {
	data, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(userDir, "user.json"), data, 0644)
}

func readUserJSON(userDir string) (userRecord, error) {
	data, err := os.ReadFile(filepath.Join(userDir, "user.json"))
	if err != nil {
		return userRecord{}, err
	}
	var rec userRecord
	return rec, json.Unmarshal(data, &rec)
}
