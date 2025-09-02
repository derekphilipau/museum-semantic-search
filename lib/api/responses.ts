import { NextResponse } from 'next/server';

// Standardized error response
export function errorResponse(message: string, status: number = 500) {
  return NextResponse.json({ error: message }, { status });
}

// Standardized success response
export function successResponse<T>(data: T, headers?: HeadersInit) {
  return NextResponse.json(data, { headers });
}

// Handle API errors consistently
export function handleApiError(error: unknown): NextResponse {
  console.error('API Error:', error);
  
  if (error instanceof Error) {
    // Check if error has a status code
    const statusCode = 'statusCode' in error ? 
      (error as Error & { statusCode?: number }).statusCode || 500 : 500;
    
    return errorResponse(error.message, statusCode);
  }
  
  return errorResponse('An unexpected error occurred', 500);
}