import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pyautogui
import socket

app = FastAPI(title="VS Code Remote Server")

# Disable fail-safe if you want to allow remote movement to corners
pyautogui.FAILSAFE = False

class ShortcutRequest(BaseModel):
    # keys: list of keys to press simultaneously, e.g. ["ctrl", "c"]
    keys: list[str]

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

@app.get("/")
def read_root():
    return {"status": "online", "message": "VS Code Controller Server is running"}

@app.post("/press")
def press_keys(request: ShortcutRequest):
    try:
        print(f"Executing: {request.keys}")
        pyautogui.hotkey(*request.keys)
        return {"status": "success", "executed": request.keys}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    ip = get_local_ip()
    print(f"\n{'='*50}")
    print(f" SERVER STARTED!")
    print(f" Connect your phone to: http://{ip}:5000")
    print(f"{'='*50}\n")
    uvicorn.run(app, host="0.0.0.0", port=5000)
