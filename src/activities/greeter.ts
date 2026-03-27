export async function greet(name: string): Promise<string> {
	console.log(`[activity] greet called with: ${name}`);
	return `Hello, ${name}! Temporal is working.`;
}
