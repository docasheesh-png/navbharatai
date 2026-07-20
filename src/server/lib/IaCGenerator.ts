// GA-15 — Infrastructure-as-Code generators (Kubernetes manifests, Helm chart, Terraform for Cloud Run).
//
// The Dockerfile/compose/CI half lives in DeployArtifactGenerator; this is the deploy-to-infra half. Every
// output is a REAL, deterministic artifact an operator can `kubectl apply` / `helm install` / `terraform
// apply` — non-root containers, health probes, resource limits, HPA, and an ingress, generated from the
// app's own port/image/env. PURE string builders, unit-tested; no network, no I/O, never throws.

export interface IaCOptions {
  /** App/service name — sanitised to a DNS-1123 label for k8s. Default 'app'. */
  appName?: string;
  /** Container image reference (e.g. 'ghcr.io/acme/app:1.2.3'). Default 'app:latest'. */
  image?: string;
  /** Container port the app listens on. Default 8080. */
  port?: number;
  /** Desired replica count. Default 2. */
  replicas?: number;
  /** Environment variables as 'KEY=value' or 'KEY' (value blanked) strings. */
  env?: ReadonlyArray<string>;
  /** Ingress host (e.g. 'app.example.com'). Omit to skip the Ingress. */
  host?: string;
  /** HTTP path the liveness/readiness probes hit. Default '/health'. */
  healthPath?: string;
}

/** DNS-1123 label: lowercase alphanumeric + '-', must start/end alphanumeric, max 63 chars. */
export function toK8sName(name: string | undefined): string {
  const s = (name || 'app').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  return s.replace(/-+$/g, '') || 'app';
}

interface Resolved {
  name: string; image: string; port: number; replicas: number; healthPath: string;
  env: Array<{ name: string; value: string }>;
  host?: string;
}

function resolve(opts: IaCOptions): Resolved {
  const port = typeof opts.port === 'number' && opts.port > 0 ? Math.floor(opts.port) : 8080;
  const replicas = typeof opts.replicas === 'number' && opts.replicas > 0 ? Math.floor(opts.replicas) : 2;
  const env = (opts.env || [])
    .map((e) => String(e))
    .filter((e) => /^[A-Za-z_][A-Za-z0-9_]*(=|$)/.test(e))
    .map((e) => { const i = e.indexOf('='); return i === -1 ? { name: e, value: '' } : { name: e.slice(0, i), value: e.slice(i + 1) }; });
  return {
    name: toK8sName(opts.appName),
    image: (opts.image || '').trim() || 'app:latest',
    port, replicas,
    healthPath: (opts.healthPath || '/health').trim() || '/health',
    env,
    host: opts.host?.trim() || undefined,
  };
}

/** Kubernetes Deployment + Service (+ Ingress + HPA) as a single multi-document YAML. */
export function generateK8sManifests(opts: IaCOptions = {}): string {
  const r = resolve(opts);
  const envBlock = r.env.length
    ? ['        env:', ...r.env.map((e) => `        - name: ${e.name}\n          value: ${JSON.stringify(e.value)}`)]
    : [];
  const deployment = [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    `  name: ${r.name}`,
    `  labels:`,
    `    app: ${r.name}`,
    'spec:',
    `  replicas: ${r.replicas}`,
    '  selector:',
    `    matchLabels:`,
    `      app: ${r.name}`,
    '  template:',
    '    metadata:',
    `      labels:`,
    `        app: ${r.name}`,
    '    spec:',
    '      securityContext:',
    '        runAsNonRoot: true',
    '        runAsUser: 1000',
    '      containers:',
    `      - name: ${r.name}`,
    `        image: ${r.image}`,
    '        ports:',
    `        - containerPort: ${r.port}`,
    ...envBlock,
    '        resources:',
    '          requests:',
    '            cpu: 100m',
    '            memory: 128Mi',
    '          limits:',
    '            cpu: 500m',
    '            memory: 512Mi',
    '        livenessProbe:',
    '          httpGet:',
    `            path: ${r.healthPath}`,
    `            port: ${r.port}`,
    '          initialDelaySeconds: 10',
    '          periodSeconds: 15',
    '        readinessProbe:',
    '          httpGet:',
    `            path: ${r.healthPath}`,
    `            port: ${r.port}`,
    '          initialDelaySeconds: 5',
    '          periodSeconds: 10',
  ].join('\n');

  const service = [
    'apiVersion: v1',
    'kind: Service',
    'metadata:',
    `  name: ${r.name}`,
    'spec:',
    '  type: ClusterIP',
    '  selector:',
    `    app: ${r.name}`,
    '  ports:',
    '  - port: 80',
    `    targetPort: ${r.port}`,
    '    protocol: TCP',
  ].join('\n');

  const hpa = [
    'apiVersion: autoscaling/v2',
    'kind: HorizontalPodAutoscaler',
    'metadata:',
    `  name: ${r.name}`,
    'spec:',
    '  scaleTargetRef:',
    '    apiVersion: apps/v1',
    '    kind: Deployment',
    `    name: ${r.name}`,
    `  minReplicas: ${r.replicas}`,
    `  maxReplicas: ${Math.max(r.replicas * 5, 10)}`,
    '  metrics:',
    '  - type: Resource',
    '    resource:',
    '      name: cpu',
    '      target:',
    '        type: Utilization',
    '        averageUtilization: 70',
  ].join('\n');

  const docs = [deployment, service, hpa];
  if (r.host) {
    docs.push([
      'apiVersion: networking.k8s.io/v1',
      'kind: Ingress',
      'metadata:',
      `  name: ${r.name}`,
      '  annotations:',
      '    nginx.ingress.kubernetes.io/rewrite-target: /',
      'spec:',
      '  rules:',
      `  - host: ${r.host}`,
      '    http:',
      '      paths:',
      '      - path: /',
      '        pathType: Prefix',
      '        backend:',
      '          service:',
      `            name: ${r.name}`,
      '            port:',
      '              number: 80',
    ].join('\n'));
  }
  return docs.join('\n---\n') + '\n';
}

/** A minimal, valid Helm chart (Chart.yaml, values.yaml, templates) as a path→content map. */
export function generateHelmChart(opts: IaCOptions = {}): Record<string, string> {
  const r = resolve(opts);
  const chartYaml = [
    'apiVersion: v2',
    `name: ${r.name}`,
    'description: A Helm chart generated by NavBharatAI',
    'type: application',
    'version: 0.1.0',
    'appVersion: "1.0.0"',
    '',
  ].join('\n');

  const valuesYaml = [
    `replicaCount: ${r.replicas}`,
    'image:',
    `  repository: ${r.image.split(':')[0] || 'app'}`,
    `  tag: ${r.image.includes(':') ? r.image.slice(r.image.lastIndexOf(':') + 1) : 'latest'}`,
    '  pullPolicy: IfNotPresent',
    'service:',
    '  type: ClusterIP',
    '  port: 80',
    `  targetPort: ${r.port}`,
    'resources:',
    '  requests:',
    '    cpu: 100m',
    '    memory: 128Mi',
    '  limits:',
    '    cpu: 500m',
    '    memory: 512Mi',
    'ingress:',
    `  enabled: ${r.host ? 'true' : 'false'}`,
    `  host: ${r.host || 'app.example.com'}`,
    `healthPath: ${r.healthPath}`,
    'env: {}',
    '',
  ].join('\n');

  const deploymentTpl = [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: {{ .Release.Name }}',
    'spec:',
    '  replicas: {{ .Values.replicaCount }}',
    '  selector:',
    '    matchLabels:',
    '      app: {{ .Release.Name }}',
    '  template:',
    '    metadata:',
    '      labels:',
    '        app: {{ .Release.Name }}',
    '    spec:',
    '      securityContext:',
    '        runAsNonRoot: true',
    '        runAsUser: 1000',
    '      containers:',
    '      - name: {{ .Release.Name }}',
    '        image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"',
    '        imagePullPolicy: {{ .Values.image.pullPolicy }}',
    '        ports:',
    '        - containerPort: {{ .Values.service.targetPort }}',
    '        {{- if .Values.env }}',
    '        env:',
    '        {{- range $k, $v := .Values.env }}',
    '        - name: {{ $k }}',
    '          value: {{ $v | quote }}',
    '        {{- end }}',
    '        {{- end }}',
    '        resources: {{- toYaml .Values.resources | nindent 10 }}',
    '        livenessProbe:',
    '          httpGet:',
    '            path: {{ .Values.healthPath }}',
    '            port: {{ .Values.service.targetPort }}',
    '        readinessProbe:',
    '          httpGet:',
    '            path: {{ .Values.healthPath }}',
    '            port: {{ .Values.service.targetPort }}',
    '',
  ].join('\n');

  const serviceTpl = [
    'apiVersion: v1',
    'kind: Service',
    'metadata:',
    '  name: {{ .Release.Name }}',
    'spec:',
    '  type: {{ .Values.service.type }}',
    '  selector:',
    '    app: {{ .Release.Name }}',
    '  ports:',
    '  - port: {{ .Values.service.port }}',
    '    targetPort: {{ .Values.service.targetPort }}',
    '',
  ].join('\n');

  const ingressTpl = [
    '{{- if .Values.ingress.enabled }}',
    'apiVersion: networking.k8s.io/v1',
    'kind: Ingress',
    'metadata:',
    '  name: {{ .Release.Name }}',
    'spec:',
    '  rules:',
    '  - host: {{ .Values.ingress.host }}',
    '    http:',
    '      paths:',
    '      - path: /',
    '        pathType: Prefix',
    '        backend:',
    '          service:',
    '            name: {{ .Release.Name }}',
    '            port:',
    '              number: {{ .Values.service.port }}',
    '{{- end }}',
    '',
  ].join('\n');

  return {
    [`${r.name}/Chart.yaml`]: chartYaml,
    [`${r.name}/values.yaml`]: valuesYaml,
    [`${r.name}/templates/deployment.yaml`]: deploymentTpl,
    [`${r.name}/templates/service.yaml`]: serviceTpl,
    [`${r.name}/templates/ingress.yaml`]: ingressTpl,
    [`${r.name}/.helmignore`]: '.git\n.gitignore\n*.tmp\n',
  };
}

/** Terraform for a Google Cloud Run deploy (matches NavBharatAI's own target) as a path→content map. */
export function generateTerraformCloudRun(opts: IaCOptions = {}): Record<string, string> {
  const r = resolve(opts);
  const envBlock = r.env.map((e) => [
    '    env {',
    `      name  = ${JSON.stringify(e.name)}`,
    `      value = ${JSON.stringify(e.value)}`,
    '    }',
  ].join('\n')).join('\n');

  const mainTf = [
    'terraform {',
    '  required_providers {',
    '    google = {',
    '      source  = "hashicorp/google"',
    '      version = "~> 5.0"',
    '    }',
    '  }',
    '}',
    '',
    'provider "google" {',
    '  project = var.project_id',
    '  region  = var.region',
    '}',
    '',
    `resource "google_cloud_run_v2_service" "${r.name}" {`,
    `  name     = ${JSON.stringify(r.name)}`,
    '  location = var.region',
    '  ingress  = "INGRESS_TRAFFIC_ALL"',
    '',
    '  template {',
    '    scaling {',
    '      min_instance_count = 0',
    `      max_instance_count = ${Math.max(r.replicas * 5, 10)}`,
    '    }',
    '    containers {',
    '      image = var.image',
    '      ports {',
    `        container_port = ${r.port}`,
    '      }',
    envBlock ? envBlock : '',
    '    }',
    '  }',
    '}',
    '',
    '# Allow unauthenticated (public) access.',
    `resource "google_cloud_run_v2_service_iam_member" "public" {`,
    `  name     = google_cloud_run_v2_service.${r.name}.name`,
    `  location = google_cloud_run_v2_service.${r.name}.location`,
    '  role     = "roles/run.invoker"',
    '  member   = "allUsers"',
    '}',
    '',
  ].filter((l) => l !== '').join('\n') + '\n';

  const variablesTf = [
    'variable "project_id" {',
    '  type        = string',
    '  description = "The GCP project ID to deploy into."',
    '}',
    '',
    'variable "region" {',
    '  type        = string',
    '  default     = "asia-southeast1"',
    '  description = "The Cloud Run region."',
    '}',
    '',
    'variable "image" {',
    '  type        = string',
    `  default     = ${JSON.stringify(r.image)}`,
    '  description = "The container image to deploy."',
    '}',
    '',
  ].join('\n');

  const outputsTf = [
    'output "service_url" {',
    `  value       = google_cloud_run_v2_service.${r.name}.uri`,
    '  description = "The public URL of the deployed Cloud Run service."',
    '}',
    '',
  ].join('\n');

  return { 'terraform/main.tf': mainTf, 'terraform/variables.tf': variablesTf, 'terraform/outputs.tf': outputsTf };
}

/** Ansible playbook that deploys the app as a Docker container to operator-provided SSH hosts.
 *  Real + deterministic: pulls the image and runs it with a port mapping, env, restart policy and a
 *  healthcheck via community.docker. HONEST: it deploys to hosts YOU provide over SSH — it does not
 *  provision the servers themselves (that is Terraform's job). */
export function generateAnsiblePlaybook(opts: IaCOptions = {}): Record<string, string> {
  const r = resolve(opts);
  const healthUrl = `http://localhost:${r.port}${r.healthPath}`;
  const envLines = r.env.length
    ? ['        env:', ...r.env.map((e) => `          ${e.name}: ${JSON.stringify(e.value)}`)]
    : [];

  const playbook = [
    '---',
    `# Deploy ${r.name} as a Docker container to the target hosts.`,
    '# Requires the Docker collection:  ansible-galaxy collection install community.docker',
    `- name: Deploy ${r.name}`,
    '  hosts: web',
    '  become: true',
    '  vars:',
    `    image: ${JSON.stringify(r.image)}`,
    `    container_name: ${JSON.stringify(r.name)}`,
    `    host_port: ${r.port}`,
    `    container_port: ${r.port}`,
    '  tasks:',
    '    - name: Ensure Docker is installed',
    '      ansible.builtin.package:',
    '        name: docker.io',
    '        state: present',
    '',
    '    - name: Pull the application image',
    '      community.docker.docker_image:',
    '        name: "{{ image }}"',
    '        source: pull',
    '        force_source: true',
    '',
    '    - name: Run the application container',
    '      community.docker.docker_container:',
    '        name: "{{ container_name }}"',
    '        image: "{{ image }}"',
    '        state: started',
    '        recreate: true',
    '        restart_policy: unless-stopped',
    '        ports:',
    '          - "{{ host_port }}:{{ container_port }}"',
    ...envLines,
    '        healthcheck:',
    `          test: ["CMD", "wget", "-qO-", ${JSON.stringify(healthUrl)}]`,
    '          interval: 30s',
    '          timeout: 5s',
    '          retries: 3',
    '',
  ].join('\n');

  const inventory = [
    '[web]',
    '# Add your server(s) here, for example:',
    '# app-1 ansible_host=203.0.113.10 ansible_user=ubuntu',
    '',
  ].join('\n');

  const readme = [
    `# Ansible deploy — ${r.name}`,
    '',
    'This playbook deploys the app as a Docker container to hosts **you** provide over SSH.',
    '',
    '```bash',
    'ansible-galaxy collection install community.docker',
    '# edit inventory.ini with your server(s), then:',
    'ansible-playbook -i inventory.ini playbook.yml',
    '```',
    '',
    `It pulls \`${r.image}\` and runs it with a \`${r.port}\` port mapping and a healthcheck on \`${r.healthPath}\`.`,
    '',
    'HONEST SCOPE: this deploys onto servers you already have (SSH). It does **not** provision the servers',
    '— for that, use the Terraform target (`terraform/`) or your cloud provider.',
    '',
  ].join('\n');

  return {
    'ansible/playbook.yml': playbook,
    'ansible/inventory.ini': inventory,
    'ansible/README.md': readme,
  };
}

/** All IaC artifacts as one path→content map (k8s manifests + Helm chart + Terraform + Ansible). */
export function generateIaC(opts: IaCOptions = {}): Record<string, string> {
  return {
    'k8s/manifests.yaml': generateK8sManifests(opts),
    ...generateHelmChart(opts),
    ...generateTerraformCloudRun(opts),
    ...generateAnsiblePlaybook(opts),
  };
}
