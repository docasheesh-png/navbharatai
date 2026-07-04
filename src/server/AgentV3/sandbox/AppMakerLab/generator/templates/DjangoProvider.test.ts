import { describe, it, expect } from 'vitest';
import { DjangoProvider } from './DjangoProvider';

describe('DjangoProvider (v3.0 sandbox template) — deployable, not just previewable', () => {
  const files = new DjangoProvider().getFiles([]);

  it('emits the wsgi module the Procfile boots gunicorn against (deploy would 500 without it)', () => {
    // Regression: the Procfile runs `gunicorn myproject.wsgi` but getFiles never emitted
    // myproject/wsgi.py → production deploy died with ModuleNotFoundError while the sandbox
    // preview (runserver) looked fine.
    const procfile = files['Procfile'];
    expect(procfile).toContain('gunicorn myproject.wsgi');
    expect(files['myproject/wsgi.py']).toBeDefined();
    expect(files['myproject/wsgi.py']).toContain('get_wsgi_application()');
    expect(files['myproject/wsgi.py']).toContain("DJANGO_SETTINGS_MODULE");
  });

  it('declares WSGI_APPLICATION in settings so the wsgi module resolves', () => {
    expect(files['myproject/settings.py']).toContain("WSGI_APPLICATION = 'myproject.wsgi.application'");
  });
});
