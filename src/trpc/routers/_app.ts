import { z } from 'zod';
import { createTRPCRouter } from '../init';
import { messagesRouter } from '@/modules/messages/server/procedures';
import { projectsRouter } from '@/modules/projects/server/procedure';

export const appRouter = createTRPCRouter({
  messages: messagesRouter,
  projects: projectsRouter,
});
// export type definition of API
export type AppRouter = typeof appRouter;
