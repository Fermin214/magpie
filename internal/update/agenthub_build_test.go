package update

import "testing"

// The fork uses non-release versions, including clean commits. A semver-looking
// prerelease would still be Released and would allow an official replacement.
func TestAgentHubBuildCannotUseOfficialReplacement(t *testing.T) {
	for _, v := range []string{"agenthub-189586612eea", "agenthub-189586612eea-dirty"} {
		if Released(v) {
			t.Fatalf("%s would allow official binary replacement", v)
		}
	}
	if !Released("0.1.1178") {
		t.Fatal("upstream release classification changed")
	}
}
