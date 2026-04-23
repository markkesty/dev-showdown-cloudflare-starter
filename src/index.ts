import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {generateText} from 'ai';

const INTERACTION_ID_HEADER = 'X-Interaction-Id';

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method !== 'POST' || url.pathname !== '/api') {
			return new Response('Not Found', {status: 404});
		}

		const challengeType = url.searchParams.get('challengeType');
		if (!challengeType) {
			return new Response('Missing challengeType query parameter', {
				status: 400,
			});
		}

		const interactionId = request.headers.get(INTERACTION_ID_HEADER);
		if (!interactionId) {
			return new Response(`Missing ${INTERACTION_ID_HEADER} header`, {
				status: 400,
			});
		}

		const payload = await request.json<any>();

		switch (challengeType) {
			case 'HELLO_WORLD':
				return Response.json({
					greeting: `Hello ${payload.name}`,
				});
			case 'BASIC_LLM': {
				if (!env.DEV_SHOWDOWN_API_KEY) {
					throw new Error('DEV_SHOWDOWN_API_KEY is required');
				}

				const workshopLlm = createWorkshopLlm(env.DEV_SHOWDOWN_API_KEY, interactionId);
				const result = await generateText({
					model: workshopLlm.chatModel('deli-4'),
					system: 'You are a trivia question player. Answer the question correctly and concisely.',
					prompt: payload.question,
				});

				return Response.json({
					answer: result.text || 'N/A',
				});
			}
			case 'JSON_MODE': {
				if (!env.DEV_SHOWDOWN_API_KEY) {
					throw new Error('DEV_SHOWDOWN_API_KEY is required');
				}

				const jsonLlm = createWorkshopLlm(env.DEV_SHOWDOWN_API_KEY, interactionId);
				const jsonResult = await generateText({
					model: jsonLlm.chatModel('deli-4'),
					system: `Extract structured product information from the description. Return ONLY a valid JSON object with this exact structure, no markdown fences:
{
  "name": "<full product name including the product type, e.g. 'Vector Harbor A142 chair'>",
  "price": <number>,
  "currency": "<3-letter code>",
  "inStock": <true if "in stock", false if "out of stock">,
  "dimensions": { "length": <number>, "width": <number>, "height": <number>, "unit": "<unit>" },
  "manufacturer": { "name": "<name>", "country": "<country>", "website": "<url>" },
  "specifications": { "weight": <number>, "weightUnit": "<unit>", "warrantyMonths": <number> }
}`,
					prompt: payload.description,
				});

				const parsed = JSON.parse(jsonResult.text.replace(/```json\n?|```\n?/g, '').trim());
				return Response.json(parsed);
			}
			case 'BASIC_TOOL_CALL': {
				if (!env.DEV_SHOWDOWN_API_KEY) {
					throw new Error('DEV_SHOWDOWN_API_KEY is required');
				}

				const toolLlm = createWorkshopLlm(env.DEV_SHOWDOWN_API_KEY, interactionId);

				const toolResult = await generateText({
					model: toolLlm.chatModel('deli-4'),
					system: 'You answer questions about weather. Use the getWeather tool to fetch current weather data, then respond with a natural language answer that includes the temperature.',
					prompt: payload.question,
					tools: {
						getWeather: {
							description: 'Get current weather for a city',
							parameters: {
								type: 'object' as const,
								properties: {
									city: { type: 'string' as const, description: 'City name' },
								},
								required: ['city'],
							},
							execute: async ({ city }: { city: string }) => {
								const weatherRes = await fetch('https://devshowdown.com/api/weather', {
									method: 'POST',
									headers: {
										'Content-Type': 'application/json',
										[INTERACTION_ID_HEADER]: interactionId,
									},
									body: JSON.stringify({ city }),
								});
								return await weatherRes.json();
							},
						},
					},
					maxSteps: 3,
				});

				return Response.json({ answer: toolResult.text });
			}
			default:
				return new Response('Solver not found', {status: 404});
		}
	},
} satisfies ExportedHandler<Env>;

function createWorkshopLlm(apiKey: string, interactionId: string) {
	return createOpenAICompatible({
		name: 'dev-showdown',
		baseURL: 'https://devshowdown.com/v1',
		supportsStructuredOutputs: true,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			[INTERACTION_ID_HEADER]: interactionId,
		},
	});
}
