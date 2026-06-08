import { ProjectBlueprint } from './ProjectBlueprint';

export interface ProjectTemplate {
  roles: { [key: string]: string[] };
  pages: { [key: string]: string[] };
  entities: { [key: string]: { [key: string]: string } };
  apiEndpoints: { path: string, method: "GET" | "POST" | "PUT" | "DELETE", description: string }[];
}

export const ProjectTemplates: { [key: string]: ProjectTemplate } = {
  "App": {
    roles: { "User": ["read"], "Admin": ["read", "write"] },
    pages: { "/": ["Dashboard"], "/settings": ["SettingsForm"] },
    entities: { "User": { "id": "string", "name": "string" } },
    apiEndpoints: [{ path: "/api/data", method: "GET", description: "Get data" }]
  },
  "Website": {
    roles: { "Visitor": ["read"] },
    pages: { "/": ["Home"], "/about": ["About"] },
    entities: { "Content": { "id": "string", "title": "string" } },
    apiEndpoints: [{ path: "/api/content", method: "GET", description: "Get content" }]
  },
  "Game": {
    roles: { "Player": ["play"] },
    pages: { "/": ["GameView"] },
    entities: { "PlayerStats": { "id": "string", "score": "number" } },
    apiEndpoints: [{ path: "/api/stats", method: "POST", description: "Update stats" }]
  }
};

export function inferType(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("game")) return "Game";
  if (p.includes("website") || p.includes("blog")) return "Website";
  return "App";
}
