import { ITemplateProvider } from './ViteReactProvider';

const REQUIREMENTS = `fastapi>=0.110.0
uvicorn[standard]>=0.27.0
pydantic>=2.0.0
`;

const MAIN_PY = `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

app = FastAPI(title="My FastAPI App")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI!", "status": "ok"}

@app.get("/health")
def health():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 3000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
`;

export class PythonFastapiProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'requirements.txt': REQUIREMENTS,
      'main.py': MAIN_PY,
    };
  }
}
