import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function claudeAgent(
	prompt: string,
	systemPrompt?: string,
): Promise<string> {
	console.log(
		`[activity] claudeAgent called with prompt: ${prompt.slice(0, 80)}...`,
	);

	const response = await client.messages.create({
		model: "claude-sonnet-4-6",
		max_tokens: 4096,
		...(systemPrompt ? { system: systemPrompt } : {}),
		messages: [{ role: "user", content: prompt }],
	});

	const text = response.content
		.filter((block): block is Anthropic.TextBlock => block.type === "text")
		.map((block) => block.text)
		.join("\n");

	console.log(`[activity] claudeAgent response length: ${text.length} chars`);
	return text;
}
