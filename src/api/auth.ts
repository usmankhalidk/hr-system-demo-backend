import client from './client';
import { User } from '../types';

export async function login(email: string, password: string): Promise<{ token: string; user: User }> {
  const { data } = await client.post('/auth/login', { email, password });
  return data;
}

export async function getMe(): Promise<User> {
  const { data } = await client.get('/auth/me');
  return data;
}
