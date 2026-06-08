import axios from 'axios';

export interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  type: 'file' | 'dir';
}

export interface GitHubRepoContext {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

const API_BASE = '/api/github';

export class GitHubService {
  static async getRepoTree(context: GitHubRepoContext, path: string = '') {
    const res = await axios.post(`${API_BASE}/fetch`, { 
      owner: context.owner, 
      repo: context.repo, 
      path 
    }, {
      headers: { Authorization: `token ${context.token}` }
    });
    return res.data.tree || [];
  }

  static async getFileContent(context: GitHubRepoContext, path: string) {
    const res = await axios.post(`${API_BASE}/file`, { 
      owner: context.owner, 
      repo: context.repo, 
      path 
    }, {
      headers: { Authorization: `token ${context.token}` }
    });
    return res.data;
  }

  static async updateFile(context: GitHubRepoContext, path: string, content: string, message: string, sha: string) {
    // Note: The /api/github/push is for bulk update. We can use it or create a single file update proxy.
    // For now, let's use the bulk push with a single file for single file updates.
    const res = await axios.post(`${API_BASE}/push`, { 
      owner: context.owner, 
      repo: context.repo, 
      files: { [path]: content },
      message, 
      branch: context.branch 
    }, {
      headers: { Authorization: `token ${context.token}` }
    });
    return { commit: { sha: res.data.sha }, content: { html_url: '' } }; // Mocking minimal return for existing code
  }

  static async getBranches(context: Partial<GitHubRepoContext>) {
    const res = await axios.post(`${API_BASE}/branches`, { 
      owner: context.owner, 
      repo: context.repo 
    }, {
      headers: { Authorization: `token ${context.token}` }
    });
    return res.data.branches;
  }

  static async createPullRequest(context: GitHubRepoContext, title: string, body: string, head: string, base: string) {
    // This one is not proxied yet, let's just keep it direct for now if needed, 
    // but better would be to proxy everything.
    const url = `https://api.github.com/repos/${context.owner}/${context.repo}/pulls`;
    const response = await axios.post(url, {
      title,
      body,
      head,
      base
    }, { headers: { Authorization: `token ${context.token}`, Accept: 'application/vnd.github.v3+json' } });
    return response.data;
  }
}
