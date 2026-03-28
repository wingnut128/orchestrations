import { readFile } from "node:fs/promises";
import { Connection } from "@temporalio/client";
import { NativeConnection } from "@temporalio/worker";
import { config } from "./config.ts";

export const namespace = config.temporal.namespace;

interface ConnectionOpts {
	address: string;
	tls?: { clientCertPair?: { crt: Buffer; key: Buffer } } | boolean;
	apiKey?: string;
}

async function buildConnectionOpts(): Promise<ConnectionOpts> {
	const { address, apiKey, tls } = config.temporal;
	const opts: ConnectionOpts = { address };

	const useMtls = tls.certPath && tls.keyPath;

	if (useMtls) {
		opts.tls = {
			clientCertPair: {
				crt: await readFile(tls.certPath),
				key: await readFile(tls.keyPath),
			},
		};
	} else if (apiKey) {
		// API key auth requires TLS; true enables default system CA certs
		opts.tls = true;
		opts.apiKey = apiKey;
	}

	return opts;
}

/** Create a client Connection (for clients, activities, webhook). */
export async function createConnection(): Promise<Connection> {
	const opts = await buildConnectionOpts();
	return Connection.connect(opts);
}

/** Create a NativeConnection (for workers). */
export async function createNativeConnection(): Promise<NativeConnection> {
	const opts = await buildConnectionOpts();
	return NativeConnection.connect(opts);
}
