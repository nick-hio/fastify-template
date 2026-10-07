import { z } from 'zod';

export const StringSchema = z.string().min(1).max(128);
