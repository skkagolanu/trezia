import { NextResponse } from 'next/server';
import { DEMO_COOKIE } from '@/lib/demo/session';

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.delete(DEMO_COOKIE);
  return response;
}
