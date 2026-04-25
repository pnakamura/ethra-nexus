import { z } from 'zod'

export const loginSchema = z.object({
  slug: z.string().min(1, 'Slug obrigatório'),
  password: z.string().min(1, 'Senha obrigatória'),
})

export const signupSchema = z
  .object({
    name: z.string().min(2, 'Nome mínimo 2 caracteres'),
    slug: z
      .string()
      .min(2, 'Slug mínimo 2 caracteres')
      .regex(/^[a-z0-9-]+$/, 'Apenas letras minúsculas, números e hífens'),
    password: z.string().min(8, 'Senha mínima 8 caracteres'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Senhas não coincidem',
    path: ['confirmPassword'],
  })

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
