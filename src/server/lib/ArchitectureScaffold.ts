/**
 * NAMED ARCHITECTURES — Clean, DDD, MVC, Hexagonal — as a scaffold whose rules are ENFORCED.
 *
 * ROADMAP §2, the second half of "service-split generator + named paradigms".
 *
 * 🔒 WHY THIS SHIPS AN ESLINT RULE AND NOT JUST FOLDERS. Creating `domain/`, `application/` and
 * `infrastructure/` directories takes ten lines and accomplishes nothing: within a fortnight someone
 * imports the database client straight into a domain file, and the architecture exists only in the
 * README. The single thing that makes a layered architecture real is a machine refusing the import
 * that breaks it. So every scaffold here ships `import/no-restricted-paths` zones matching its own
 * layering — the boundary is checked by the linter the project already runs, on every commit.
 *
 * An architecture that is only documented is decoration. This generates the enforcement.
 */

export type ArchitectureStyle = 'clean' | 'ddd' | 'mvc' | 'hexagonal';

export interface ArchitectureScaffoldResult {
  files: Record<string, string>;
  /** Directories created, in dependency order (innermost first). */
  layers: string[];
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

interface LayerSpec {
  /** Directory, relative to `src/`. */
  dir: string;
  /** One line the user can actually understand. */
  purpose: string;
  /** Layers this one is allowed to import. Everything else is refused by the linter. */
  mayImport: string[];
}

const STYLES: Record<ArchitectureStyle, { title: string; blurb: string; layers: LayerSpec[] }> = {
  clean: {
    title: 'Clean Architecture',
    blurb:
      'Business rules sit in the middle and know nothing about the database or the web. Everything points inwards, ' +
      'so you can change your database or your UI without touching the rules that make your app what it is.',
    layers: [
      { dir: 'domain', purpose: 'Your business rules and types. Depends on nothing.', mayImport: [] },
      { dir: 'application', purpose: 'The things your app DOES (use cases), written against the domain.', mayImport: ['domain'] },
      { dir: 'infrastructure', purpose: 'The database, APIs and other outside systems.', mayImport: ['domain', 'application'] },
      { dir: 'presentation', purpose: 'Screens, components and routes.', mayImport: ['domain', 'application'] },
    ],
  },
  ddd: {
    title: 'Domain-Driven Design',
    blurb:
      'The code is organised around the real things your business talks about (orders, customers), not around ' +
      'technical layers. Each area owns its own rules.',
    layers: [
      { dir: 'domain', purpose: 'Entities, value objects and the rules that govern them.', mayImport: [] },
      { dir: 'application', purpose: 'Application services that coordinate the domain.', mayImport: ['domain'] },
      { dir: 'infrastructure', purpose: 'Repositories and outside systems that serve the domain.', mayImport: ['domain', 'application'] },
      { dir: 'interfaces', purpose: 'HTTP routes, UI and anything the outside world touches.', mayImport: ['domain', 'application'] },
    ],
  },
  mvc: {
    title: 'Model – View – Controller',
    blurb:
      'The familiar three-part split: data (model), screens (view) and the code that connects them (controller). ' +
      'The simplest structure that still keeps things separated.',
    layers: [
      { dir: 'models', purpose: 'Your data and the rules attached to it.', mayImport: [] },
      { dir: 'controllers', purpose: 'Handles a request, decides what happens.', mayImport: ['models'] },
      { dir: 'views', purpose: 'What the user sees.', mayImport: ['models'] },
    ],
  },
  hexagonal: {
    title: 'Hexagonal (Ports and Adapters)',
    blurb:
      'Your core app defines the shape of what it needs (ports); the outside world plugs in (adapters). ' +
      'Swapping a payment provider or a database means writing one adapter, not editing your app.',
    layers: [
      { dir: 'core', purpose: 'Your app, and the interfaces (ports) it needs from outside.', mayImport: [] },
      { dir: 'adapters', purpose: 'Real implementations of those ports — database, payments, email.', mayImport: ['core'] },
      { dir: 'app', purpose: 'Wires the adapters into the core and starts everything.', mayImport: ['core', 'adapters'] },
    ],
  },
};

export function isArchitectureStyle(v: unknown): v is ArchitectureStyle {
  return v === 'clean' || v === 'ddd' || v === 'mvc' || v === 'hexagonal';
}

/**
 * The lint config that makes the architecture real.
 *
 * `import/no-restricted-paths` states, for each layer, which layers may NOT import it. Built from the
 * same `mayImport` lists the README documents, so the rules and the explanation cannot drift apart —
 * a README that disagrees with the linter is worse than no README.
 */
function boundaryLintConfig(style: ArchitectureStyle): string {
  const { layers } = STYLES[style];
  const zones: Array<{ target: string; from: string; message: string }> = [];
  for (const layer of layers) {
    for (const other of layers) {
      if (other.dir === layer.dir) continue;
      if (layer.mayImport.includes(other.dir)) continue;
      zones.push({
        target: `./src/${layer.dir}`,
        from: `./src/${other.dir}`,
        message: `${layer.dir} must not import from ${other.dir} — that is the boundary this architecture exists to keep.`,
      });
    }
  }
  return `${JSON.stringify(
    {
      rules: {
        'import/no-restricted-paths': ['error', { zones }],
      },
    },
    null,
    2,
  )}\n`;
}

function readme(style: ArchitectureStyle): string {
  const { title, blurb, layers } = STYLES[style];
  const rows = layers
    .map((l) => `| \`src/${l.dir}/\` | ${l.purpose} | ${l.mayImport.length === 0 ? '— (nothing)' : l.mayImport.map((d) => `\`${d}\``).join(', ')} |`)
    .join('\n');
  return `# Architecture — ${title}

${blurb}

## Where code goes

| Folder | What lives here | May import |
|---|---|---|
${rows}

## This is enforced, not just described

\`.eslintrc.architecture.json\` contains the same rules as the table above. If you import across a
boundary the linter fails with the reason — which is the only thing that keeps an architecture real
after the first busy week. Add it to your ESLint config \`extends\` to switch it on.

## Should you use this?

If your app is small, a plain structure is better — layers add indirection, and indirection you do not
need is a cost with no benefit. This pays off when several people work on the app, or when one part
needs to change often without disturbing the rest.
`;
}

/** Generate the scaffold. Deterministic; never overwrites the user's code — it only adds folders + rules. */
export function generateArchitectureScaffold(style: ArchitectureStyle): ArchitectureScaffoldResult {
  const spec = STYLES[style];
  const files: Record<string, string> = {
    'ARCHITECTURE.md': readme(style),
    '.eslintrc.architecture.json': boundaryLintConfig(style),
  };
  // A .gitkeep per layer, so the structure survives a clone — git does not track empty directories,
  // and a scaffold that vanishes on checkout would be the "looks done" state.
  for (const layer of spec.layers) {
    files[`src/${layer.dir}/.gitkeep`] = '';
    files[`src/${layer.dir}/README.md`] = `# ${layer.dir}\n\n${layer.purpose}\n\nMay import: ${layer.mayImport.length === 0 ? 'nothing' : layer.mayImport.join(', ')}.\n`;
  }
  return {
    files,
    layers: spec.layers.map((l) => `src/${l.dir}`),
    dependencies: [{ name: 'eslint-plugin-import', version: '^2' }],
    instructions:
      `Set up ${spec.title}: ${spec.layers.map((l) => `src/${l.dir}`).join(', ')}. ` +
      `The boundaries are ENFORCED by .eslintrc.architecture.json (add it to your ESLint "extends"), not just ` +
      `described in ARCHITECTURE.md — an architecture nobody checks stops being true within a fortnight. ` +
      `Existing code is untouched; move files in as you go.`,
  };
}
