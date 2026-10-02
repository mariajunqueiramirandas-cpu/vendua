package discovery

import (
	"bufio"
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
)

// Local lists CUPS queues and USB serial adapters.
func Local(ctx context.Context) ([]api.Discovered, error) {
	var out []api.Discovered
	cmd := exec.CommandContext(ctx, "lpstat", "-e")
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	raw, err := cmd.Output()
	sc := bufio.NewScanner(bytes.NewReader(raw))
	for sc.Scan() {
		if q := strings.TrimSpace(sc.Text()); q != "" {
			out = append(out, SpoolerPrinter(q))
		}
	}
	for _, pattern := range []string{"/dev/ttyUSB*", "/dev/ttyACM*"} {
		ports, _ := filepath.Glob(pattern)
		for _, p := range ports {
			out = append(out, SerialPrinter(p))
		}
	}
	// No CUPS is normal on a dev box; report what else was found.
	if err != nil && len(out) > 0 {
		err = nil
	}
	return out, err
}
