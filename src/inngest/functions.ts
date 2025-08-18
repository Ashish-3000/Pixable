import { inngest } from "./client";
import {
  openai,
  createAgent,
  createTool,
  createNetwork,
  type Tool,
  type Message,
  createState,
} from "@inngest/agent-kit";
import { Sandbox } from "@e2b/code-interpreter";
import { getSandbox, lastAssistantTextMessageContent, parseAgentOuput } from "./utils";
import { z } from "zod";
import { PROMPT, FRAGMENT_TITLE_PROMPT, RESPONSE_PROMPT } from "../prompt";
import { prisma } from "../lib/db";
import { SANDBOX_TIMEOUT } from "./types";

interface AgentState {
  summary: string;
  files: {
    [path: string]: string;
  };
}

export const codeAgentFunction = inngest.createFunction(
  { id: "code-agent" },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    // Step 1: Create sandbox
    const sandboxId = await step.run("get-sandbox-id", async () => {
      const sandbox = await Sandbox.create("loveable");
      await sandbox.setTimeout(SANDBOX_TIMEOUT);
      return sandbox.sandboxId;
    });

    // Step 2: Fetch previous messages
    const previousMessages = await step.run("get-previous-messages", async () => {
      const formattedMessages: Message[] = [];

      const messages = await prisma.message.findMany({
        where: {
          projectId: event.data.projectId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 5,
      });

      for (const message of messages) {
        formattedMessages.push({
          type: "text",
          role: message.role === "ASSISTANT" ? "assistant" : "user",
          content: message.content,
        });
      }

      return formattedMessages.reverse();
    });

    // Step 3: Create initial state
    const state = createState<AgentState>(
      {
        summary: "",
        files: {},
      },
      {
        messages: previousMessages,
      }
    );

    // Step 4: Define code agent
    const codeAgent = createAgent<AgentState>({
      name: "code-agent",
      description: "An expert coding agent",
      system: PROMPT,
      model: openai({
        model: "gpt-4",
        defaultParameters: {
          temperature: 0,
        },
      }),
      tools: [
        createTool({
          name: "terminal",
          description: "Run commands in the sandbox environment.",
          parameters: z.object({
            command: z.string().describe("The command to run in the terminal"),
          }) as any,
          handler: async ({ command }, { step }) => {
            return await step?.run("terminal", async () => {
              const buffers = { stdout: "", stderr: "" };
              try {
                const sandbox = await getSandbox(sandboxId);
                const result = await sandbox.commands.run(command, {
                  onStdout: (data) => {
                    buffers.stdout += data.toString();
                  },
                  onStderr: (data) => {
                    buffers.stderr += data.toString();
                  },
                });
                return result.stdout;
              } catch (error) {
                console.error(
                  `Command failed: ${error} \nstdout: ${buffers.stdout}\nstderr: ${buffers.stderr}`
                );
                return `Command failed: ${error} \nstdout: ${buffers.stdout}\nstderr: ${buffers.stderr}`;
              }
            });
          },
        }),
        createTool({
          name: "createOrUpdateFiles",
          description: "Create or update files in the sandbox environment.",
          parameters: z.object({
            files: z.array(
              z.object({
                path: z.string(),
                content: z.string(),
              })
            ),
          }),
          handler: async ({ files }, { step, network }: Tool.Options<AgentState>) => {
            const newFiles = await step?.run("createOrUpdateFiles", async () => {
              try {
                const updatedFiles = network.state.data.files || {};
                const sandbox = await getSandbox(sandboxId);
                for (const file of files) {
                  await sandbox.files.write(file.path, file.content);
                  updatedFiles[file.path] = file.content;
                }
                return updatedFiles;
              } catch (error) {
                console.error(`File operation failed: ${error}`);
                return `File operation failed: ${error}`;
              }
            });

            if (typeof newFiles === "object") {
              network.state.data.files = newFiles;
              console.log("Updated files state:", newFiles);
            }

            return `Successfully created/updated ${files.length} files`;
          },
        }),
        createTool({
          name: "readFiles",
          description: "Read files from the sandbox",
          parameters: z.object({
            files: z.array(z.string()),
          }),
          handler: async ({ files }, { step }) => {
            return await step?.run("readFiles", async () => {
              try {
                const sandbox = await getSandbox(sandboxId);
                const contents = [];
                for (const file of files) {
                  const content = await sandbox.files.read(file);
                  contents.push({ path: file, content });
                }
                return JSON.stringify(contents);
              } catch (error) {
                return "Error: " + error;
              }
            });
          },
        }),
      ],
      lifecycle: {
        onResponse: async ({ result, network }) => {
          const lastMsgContent = lastAssistantTextMessageContent(result);
          console.log("Last assistant message:", lastMsgContent);

          if (lastMsgContent && network) {
            if (lastMsgContent.includes("<task_summary")) {
              network.state.data.summary = lastMsgContent;
              console.log("Set summary:", lastMsgContent);
            }
          }

          return result;
        },
      },
    });

    // Step 5: Define agent network
    const network = createNetwork<AgentState>({
      name: "coding-agent-network",
      agents: [codeAgent],
      maxIter: 15,
      defaultState: state,
      router: async ({ network }) => {
        const summary = network.state.data.summary;
        console.log("Router check - summary:", summary);
        if (summary) {
          console.log("Router stopping - summary found");
          return;
        }
        console.log("Router continuing - no summary yet");
        return codeAgent;
      },
    });

    // Initialize state
    network.state.data = { summary: "", files: {} };

    // Step 6: Run the network
    const result = await network.run(event.data.value, { state });

    // Step 7: Generators
    const fragmentTitleGenerator = createAgent<AgentState>({
      name: "fragment-title-generator",
      description: "A fragment title generator",
      system: FRAGMENT_TITLE_PROMPT,
      model: openai({ model: "gpt-4o" }),
    });

    const responseGenerator = createAgent<AgentState>({
      name: "response-generator",
      description: "A response generator",
      system: RESPONSE_PROMPT,
      model: openai({ model: "gpt-4o" }),
    });

    const { output: fragmentTitleOutput } = await fragmentTitleGenerator.run(
      result.state.data.summary
    );
    const { output: responseOutput } = await responseGenerator.run(
      result.state.data.summary
    );

    // Debug logs
    console.log("Agent result:", {
      summary: result.state.data.summary,
      files: result.state.data.files,
      filesCount: Object.keys(result.state.data.files || {}).length,
    });

    const isError =
      !result.state.data.summary ||
      Object.keys(result.state.data.files || {}).length === 0;

    // Step 8: Sandbox URL
    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const sandbox = await getSandbox(sandboxId);
      const host = sandbox.getHost(3000);
      return `http://${host}`;
    });

    // Step 9: Save result to DB
    await step.run("save-result", async () => {
      if (isError) {
        return await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: "Something went wrong, pls. try again.",
            role: "ASSISTANT",
            type: "RESULT",
          },
        });
      }
      return await prisma.message.create({
        data: {
          projectId: event.data.projectId,
          content: parseAgentOuput(fragmentTitleOutput),
          role: "ASSISTANT",
          type: "RESULT",
          fragment: {
            create: {
              sandboxUrl,
              title: parseAgentOuput(responseOutput),
              files: result.state.data.files,
            },
          },
        },
      });
    });

    // Step 10: Final result
    const finalResult = {
      url: sandboxUrl,
      title: "Fragment",
      files: result.state.data.files,
      summary: result.state.data.summary,
    };

    console.log("Final result:", finalResult);

    return finalResult;
  }
);