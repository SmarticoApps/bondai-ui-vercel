// app/api/streamchat/route.ts
import { 
  StreamingTextResponse,
  AIStreamCallbacksAndOptions,
} from 'ai';

export const runtime = 'edge';

type Message = {
  role: string;
  content: any;
};

function loadChatTemplate(messages: Message[]) {
  /*
  <|im_start|>system
  You are a helpful assistant.<|im_end|>
  <|im_start|>user
  {query}<|im_end|>
  <|im_start|>assistant
  */
  let chatMLPromptTemplate = "";
  messages.forEach((message: Message) => {
      chatMLPromptTemplate += `<|im_start|>${message.role}\n${message.content}<|im_end|>\n`;
  });
  chatMLPromptTemplate += `<|im_start|>assistant\n`
  return chatMLPromptTemplate;
}

function parseFluxStream(response: Response) {
  if (!response.body) {
    throw new Error("Response body is null");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result;
  let stop_sequences = ["<|im_end|>", "<|endoftext|>", "</s>"]
  let stop_word = "<|im_end|>"

  const readableStream = new ReadableStream({
    async pull(controller) {
      try {
        result = await reader.read();
        if (result.done) {
          controller.close();
        } else {
          const chunkAsString = decoder.decode(result.value, { stream: true });
          const chunk = JSON.parse(chunkAsString.replace("data:", ""));
          console.log(chunk.token.text)
          if (chunk.token.text.indexOf(stop_word) > -1) {
            chunk.token.text = chunk.token.text.replace(stop_word, "")
          }
          controller.enqueue(chunk.token.text);
        }
      } catch (error) {
        console.error('Error reading the stream', error);
        controller.error(error);
      }
    }
  });

  return readableStream;
}

export async function FluxStream(
  res: Response, 
  cb?: AIStreamCallbacksAndOptions
): Promise<ReadableStream> {
  const AiStream = parseFluxStream(res);
  return AiStream;
}

export async function POST(req: Request) {
  const json = await req.json()
  const { messages } = json
  let inputPrompt = loadChatTemplate(messages);
  
  const fetchResponse = await fetch('http://localhost:8081/generate_stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'inputs': inputPrompt,
      'parameters': {
        'max_new_tokens': 1000,
        'stream': true
      }
    })
  });

  const fluxStream = await FluxStream(fetchResponse, {
    onStart: async () => {
      console.log('Stream started');
    },
    onCompletion: async (completion) => {
      console.log('Completion completed', completion);
    },
    onFinal: async (completion) => {
      console.log('Stream completed', completion);
    },
    onToken: async (token) => {
      console.log('Token received', token);
    },
  });

  return new StreamingTextResponse(fluxStream)
}