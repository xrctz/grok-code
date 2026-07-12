export interface BridgeConfig {
    host: string;
    port: number;
    token: string;
    baseUrl: string;
}
/**
 * Resolve bridge connection settings from env, optional .vscode-mcp.env, or defaults.
 */
export declare function loadBridgeConfig(cwd?: string): BridgeConfig;
export declare class BridgeClient {
    private readonly config;
    constructor(config: BridgeConfig);
    get settings(): BridgeConfig;
    health(): Promise<unknown>;
    get(pathname: string, query?: Record<string, string | undefined>): Promise<unknown>;
    post(pathname: string, body?: unknown): Promise<unknown>;
    private request;
}
export declare function textResult(data: unknown): {
    content: Array<{
        type: 'text';
        text: string;
    }>;
};
export declare function errorResult(err: unknown): {
    content: Array<{
        type: 'text';
        text: string;
    }>;
    isError: true;
};
