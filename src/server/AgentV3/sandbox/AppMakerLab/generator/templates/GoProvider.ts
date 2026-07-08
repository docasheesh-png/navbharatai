import { ITemplateProvider } from './ViteReactProvider';

// Go backend scaffold — runs on the fullstack E2B template (Go 1.23). A minimal but REAL, runnable
// net/http server bound to 0.0.0.0:$PORT (so the E2B preview proxy can reach it). `go run main.go`
// starts it. Kept intentionally small — the agent builds the requested app on top of this baseline.

const GO_MOD = `module myapp

go 1.23
`;

const MAIN_GO = `package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Hello from Go!")
	})

	addr := "0.0.0.0:" + port
	log.Println("Server listening on", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
`;

export class GoProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'go.mod': GO_MOD,
      'main.go': MAIN_GO,
    };
  }
}
