import { vi } from 'vitest';

// Mock Next.js request/response
vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server');
  return {
    ...actual,
    NextRequest: class MockNextRequest {
      url: string;
      headers: Map<string, string>;
      method: string;
      private _body: string | null = null;

      constructor(url: string, options?: { method?: string; body?: string; headers?: Record<string, string> }) {
        this.url = url;
        this.method = options?.method || 'GET';
        this._body = options?.body || null;
        this.headers = new Map(Object.entries(options?.headers || {}));
      }

      async json() {
        if (!this._body) return {};
        return JSON.parse(this._body);
      }
    },
    NextResponse: {
      json: (data: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
        data,
        status: init?.status || 200,
        headers: init?.headers || {},
        async json() {
          return data;
        },
      }),
    },
  };
});

// Mock environment variables
process.env.ELASTICSEARCH_URL = 'http://localhost:9200';
process.env.ELASTICSEARCH_API_KEY = 'test-api-key';
process.env.JINA_API_KEY = 'test-jina-key';
