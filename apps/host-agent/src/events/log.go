package events

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	rePublicKey  = regexp.MustCompile(`ssh-[a-z0-9]+ AAAA[A-Za-z0-9+/=]+`)
	reToken      = regexp.MustCompile(`Bearer [A-Fa-f0-9]{64}`)
	reConfigPath = regexp.MustCompile(`/config/[^\s"]*`)
)

func Redact(s string) string {
	s = rePublicKey.ReplaceAllStringFunc(s, func(m string) string {
		parts := strings.SplitN(m, " ", 3)
		suffix := ""
		if len(parts) == 3 {
			suffix = " " + parts[2]
		}
		return "[REDACTED-PUBLIC-KEY]" + suffix
	})
	s = reToken.ReplaceAllString(s, "[REDACTED-TOKEN]")
	s = reConfigPath.ReplaceAllString(s, "[CONFIG-PATH]")
	return s
}

type EventRecord struct {
	EventID   string    `json:"eventId"`
	Timestamp time.Time `json:"timestamp"`
	Kind      string    `json:"kind"`
	AllocID   string    `json:"allocId"`
	Message   string    `json:"message"`
}

type Logger struct {
	logsDir string
}

func NewLogger(logsDir string) *Logger {
	return &Logger{logsDir: logsDir}
}

func (l *Logger) Append(kind, allocId, message string) error {
	if err := os.MkdirAll(l.logsDir, 0755); err != nil {
		return err
	}
	rec := EventRecord{
		EventID:   "evt_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:12],
		Timestamp: time.Now().UTC(),
		Kind:      kind,
		AllocID:   allocId,
		Message:   Redact(message),
	}
	data, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	path := filepath.Join(l.logsDir, "events.jsonl")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(string(data) + "\n")
	return err
}

func (l *Logger) Query(limit int, after time.Time) ([]EventRecord, error) {
	path := filepath.Join(l.logsDir, "events.jsonl")
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return []EventRecord{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var records []EventRecord
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		var rec EventRecord
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			continue
		}
		if !after.IsZero() && !rec.Timestamp.After(after) {
			continue
		}
		records = append(records, rec)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	sort.Slice(records, func(i, j int) bool {
		return records[i].Timestamp.After(records[j].Timestamp)
	})
	if limit > 0 && len(records) > limit {
		records = records[:limit]
	}
	return records, nil
}
