import { describe, it, expect } from 'vitest';
import { toK8sName, generateK8sManifests, generateHelmChart, generateTerraformCloudRun, generateAnsiblePlaybook, generateIaC } from './IaCGenerator';

describe('toK8sName (DNS-1123 label)', () => {
  it('lowercases, replaces invalid chars, trims dashes, caps length', () => {
    expect(toK8sName('My App!')).toBe('my-app');
    expect(toK8sName('__Weird__Name__')).toBe('weird-name');
    expect(toK8sName('')).toBe('app');
    expect(toK8sName(undefined)).toBe('app');
    expect(toK8sName('a'.repeat(80)).length).toBeLessThanOrEqual(63);
  });
});

describe('generateK8sManifests', () => {
  const y = generateK8sManifests({ appName: 'Todo App', image: 'ghcr.io/acme/todo:1.2.3', port: 3000, replicas: 3, env: ['NODE_ENV=production', 'API_KEY'], host: 'todo.example.com', healthPath: '/healthz' });

  it('emits a non-root Deployment with the image, port, replicas, probes and resource limits', () => {
    expect(y).toContain('kind: Deployment');
    expect(y).toContain('name: todo-app');          // sanitised
    expect(y).toContain('replicas: 3');
    expect(y).toContain('image: ghcr.io/acme/todo:1.2.3');
    expect(y).toContain('containerPort: 3000');
    expect(y).toContain('runAsNonRoot: true');       // security
    expect(y).toContain('limits:');
    expect(y).toContain('path: /healthz');           // custom health path on both probes
    expect(y).toContain('livenessProbe:');
    expect(y).toContain('readinessProbe:');
  });

  it('renders env vars (with a blanked value for a name-only entry)', () => {
    expect(y).toContain('name: NODE_ENV');
    expect(y).toContain('value: "production"');
    expect(y).toContain('name: API_KEY');
    expect(y).toContain('value: ""');
  });

  it('emits a Service (targetPort = container port) and an HPA that scales on CPU', () => {
    expect(y).toContain('kind: Service');
    expect(y).toContain('targetPort: 3000');
    expect(y).toContain('kind: HorizontalPodAutoscaler');
    expect(y).toContain('averageUtilization: 70');
    expect(y).toContain('minReplicas: 3');
    expect(y).toContain('maxReplicas: 15'); // replicas*5
  });

  it('includes an Ingress when a host is given, and omits it when not', () => {
    expect(y).toContain('kind: Ingress');
    expect(y).toContain('host: todo.example.com');
    const noHost = generateK8sManifests({ appName: 'x', port: 8080 });
    expect(noHost).not.toContain('kind: Ingress');
  });

  it('uses safe defaults (port 8080, replicas 2, image app:latest, /health)', () => {
    const d = generateK8sManifests();
    expect(d).toContain('containerPort: 8080');
    expect(d).toContain('replicas: 2');
    expect(d).toContain('image: app:latest');
    expect(d).toContain('path: /health');
  });
});

describe('generateHelmChart', () => {
  const files = generateHelmChart({ appName: 'Shop', image: 'acme/shop:2.0.0', port: 4000, replicas: 4, host: 'shop.io' });

  it('produces a valid chart layout (Chart.yaml, values.yaml, templates)', () => {
    expect(files['shop/Chart.yaml']).toContain('name: shop');
    expect(files['shop/Chart.yaml']).toContain('apiVersion: v2');
    expect(files['shop/templates/deployment.yaml']).toBeDefined();
    expect(files['shop/templates/service.yaml']).toBeDefined();
    expect(files['shop/templates/ingress.yaml']).toBeDefined();
    expect(files['shop/.helmignore']).toContain('.git');
  });

  it('parameterizes values from the image/port/replicas/host', () => {
    const v = files['shop/values.yaml'];
    expect(v).toContain('replicaCount: 4');
    expect(v).toContain('repository: acme/shop');
    expect(v).toContain('tag: 2.0.0');
    expect(v).toContain('targetPort: 4000');
    expect(v).toContain('enabled: true');
    expect(v).toContain('host: shop.io');
  });

  it('templates reference .Release.Name and .Values (real Helm templating)', () => {
    const d = files['shop/templates/deployment.yaml'];
    expect(d).toContain('{{ .Release.Name }}');
    expect(d).toContain('{{ .Values.replicaCount }}');
    expect(d).toContain('{{ .Values.image.repository }}:{{ .Values.image.tag }}');
    expect(files['shop/templates/ingress.yaml']).toContain('{{- if .Values.ingress.enabled }}');
  });
});

describe('generateTerraformCloudRun', () => {
  const files = generateTerraformCloudRun({ appName: 'api', image: 'gcr.io/proj/api:1.0', port: 8080, env: ['LOG_LEVEL=info'] });

  it('emits a real Cloud Run service with the required provider, ports and public IAM', () => {
    const main = files['terraform/main.tf'];
    expect(main).toContain('google_cloud_run_v2_service');
    expect(main).toContain('source  = "hashicorp/google"');
    expect(main).toContain('container_port = 8080');
    expect(main).toContain('roles/run.invoker');
    expect(main).toContain('member   = "allUsers"');
    expect(main).toContain('name  = "LOG_LEVEL"');
    expect(main).toContain('value = "info"');
  });

  it('declares variables (project_id/region/image) and an output URL', () => {
    expect(files['terraform/variables.tf']).toContain('variable "project_id"');
    expect(files['terraform/variables.tf']).toContain('default     = "gcr.io/proj/api:1.0"');
    expect(files['terraform/outputs.tf']).toContain('output "service_url"');
    expect(files['terraform/outputs.tf']).toContain('.uri');
  });
});

describe('generateAnsiblePlaybook', () => {
  const files = generateAnsiblePlaybook({ appName: 'API Server', image: 'ghcr.io/acme/api:2.1', port: 3000, env: ['LOG_LEVEL=info', 'SECRET'], healthPath: '/healthz' });

  it('emits a playbook, inventory and README', () => {
    expect(files['ansible/playbook.yml']).toBeDefined();
    expect(files['ansible/inventory.ini']).toBeDefined();
    expect(files['ansible/README.md']).toBeDefined();
  });

  it('uses the community.docker container module with real port/image/health', () => {
    const pb = files['ansible/playbook.yml'];
    expect(pb).toContain('community.docker.docker_container');
    expect(pb).toContain('image: "ghcr.io/acme/api:2.1"');
    expect(pb).toContain('host_port: 3000');
    expect(pb).toContain('"{{ host_port }}:{{ container_port }}"');
    expect(pb).toContain('http://localhost:3000/healthz');
    // the app name is sanitised to a DNS-1123 label
    expect(pb).toContain('container_name: "api-server"');
  });

  it('renders env vars as a YAML mapping (value quoted, blank when unset)', () => {
    const pb = files['ansible/playbook.yml'];
    expect(pb).toContain('env:');
    expect(pb).toContain('LOG_LEVEL: "info"');
    expect(pb).toContain('SECRET: ""');
  });

  it('omits the env block entirely when no env vars are given', () => {
    const pb = generateAnsiblePlaybook({ appName: 'x' })['ansible/playbook.yml'];
    expect(pb).not.toContain('env:');
  });

  it('never throws on empty input', () => {
    expect(() => generateAnsiblePlaybook()).not.toThrow();
  });
});

describe('generateIaC (combined)', () => {
  it('returns k8s manifests + the full Helm chart + terraform + ansible in one map', () => {
    const files = generateIaC({ appName: 'web', port: 5000 });
    expect(files['k8s/manifests.yaml']).toContain('kind: Deployment');
    expect(files['web/Chart.yaml']).toBeDefined();
    expect(files['terraform/main.tf']).toContain('google_cloud_run_v2_service');
    expect(files['ansible/playbook.yml']).toContain('community.docker.docker_container');
  });

  it('never throws on empty/default input', () => {
    expect(() => generateIaC()).not.toThrow();
    expect(() => generateIaC({})).not.toThrow();
  });
});
