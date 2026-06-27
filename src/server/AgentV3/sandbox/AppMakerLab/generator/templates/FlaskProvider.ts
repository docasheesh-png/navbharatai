import { ITemplateProvider } from './ViteReactProvider';

const REQUIREMENTS = `flask>=3.0,<4.0
flask-cors>=4.0,<5.0
gunicorn>=22.0,<23.0
python-dotenv>=1.0,<2.0
`;

const APP_PY = `from flask import Flask, jsonify
from flask_cors import CORS
from datetime import datetime
import os

app = Flask(__name__)
CORS(app)


@app.route('/')
def index():
    return jsonify({
        'message': 'Hello from Flask!',
        'timestamp': datetime.now().isoformat(),
    })


@app.route('/health')
def health():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
`;

const DEV_SH = `#!/bin/bash
pip install -r requirements.txt
export FLASK_APP=app.py
export FLASK_DEBUG=1
python app.py
`;

const PROCFILE = `web: gunicorn app:app --bind 0.0.0.0:$PORT
`;

const DOTENV = `FLASK_ENV=development
PORT=5000
`;

export class FlaskProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'requirements.txt': REQUIREMENTS,
      'app.py': APP_PY,
      'Procfile': PROCFILE,
      'dev.sh': DEV_SH,
      '.env.example': DOTENV,
    };
  }
}
