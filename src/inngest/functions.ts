import { inngest } from "./client";
import { openai, createAgent, createTool, createNetwork } from "@inngest/agent-kit";
import { Sandbox } from "@e2b/code-interpreter";
import { getSandbox, lastAssistantTextMessageContent } from "./utils";
import { stdout } from "process";
import { ca } from "date-fns/locale";
import { z } from "zod"; // Make sure this is imported correctly
import path from "path";
import { get } from "http";
import { PROMPT } from "../prompt";

export const helloWorld = inngest.createFunction(
    { id: "hello-world" },
    { event: "test/hello.world" },
    async ({ event, step }) => {
        const sandboxId = await step.run("get-sandbox-id", async () => {
            const sandbox = await Sandbox.create("loveable")
            return sandbox.sandboxId
        })

        const codeAgent = createAgent({
            name: "code-agent",
            system: PROMPT,
            model: openai({
                model: "gpt-4.1",
                defaultParameters: {
                    temperature: 0.,
                }
            }),
            tools: [
                createTool({
                    name: "terminal",
                    description: "Use the terminal to run commands in the sandbox environment.",
                    // Use Zod schema consistently like the official examples
                    parameters: z.object({
                        command: z.string().describe("The command to run in the terminal")
                    }) as any,
                    handler: async ({ command }, { step }) => {
                        return await step?.run("terminal", async () => {
                            const buffers = { stdout: "", stderr: "" };

                            try {
                                const sandbox = await getSandbox(sandboxId)
                                const result = await sandbox.commands.run(command, {
                                    onStdout: (data) => {
                                        buffers.stdout += data.toString();
                                    },
                                    onStderr: (data) => {
                                        buffers.stderr += data.toString();
                                    }
                                })
                                return result.stdout;
                            } catch (error) {
                                console.error(`Command failed: ${error} \nstdout: ${buffers.stdout}\nstderror: ${buffers.stderr}`)
                                return `Command failed: ${error} \nstdout: ${buffers.stdout}\nstderror: ${buffers.stderr}`;
                            }
                        })
                    }
                }),
                createTool({
                    name: "createOrUpdateFiles",
                    description: "Create or update files in the sandbox environment.",
                    parameters: z.object({
                        files: z.array(z.object({
                            path: z.string(),
                            content: z.string(),
                        })),
                    }),
                    handler: async ({ files }, { step, network }) => {
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
                                // Note: buffers is not defined in this scope - fixed
                                console.error(`File operation failed: ${error}`);
                                return `File operation failed: ${error}`;
                            }
                        })

                        if (typeof newFiles === "object") {
                            network.state.data.files = newFiles;
                        }
                    }
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
                        })
                    }
                })
            ],
            lifecycle: {
                onResponse: async ({ result, network }) => {
                    const lastMsgContent = lastAssistantTextMessageContent(result);

                    if (lastMsgContent && network) {
                        if (lastMsgContent.includes("<task_summary")) {
                            network.state.data.summary = lastMsgContent;
                        }
                    }

                    return result;
                }
            }
        });

        const network = createNetwork({
            name: "coding-agent-network",
            agents: [codeAgent],
            maxIter: 15, // how many loops the agent can do
            router: async ({ network }) => {
                const summary = network.state.data.summary;
                if (summary) {
                    return;
                }

                return codeAgent;
            }
        })

        // Run the agent with an input.  This automatically uses steps
        // to call your AI model.
        const result = await network.run(event.data.value);

        const sandboxUrl = await step.run("get-sandbox-url", async () => {
            const sandbox = await getSandbox(sandboxId);
            const host = sandbox.getHost(3000)
            return `http://${host}`;
        })

        // Fixed: changed 'output' to 'result'
        console.log("Network result:", result);

        return {
            url: sandboxUrl,
            title: "Fragment",
            files: result.state.data.files,
            summary: result.state.data.summary
        };
    },
);