export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  try {
    // Validate that the cursor is properly formatted base64url by round-tripping
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!decoded) {
      throw new Error('invalid cursor');
    }
    // Verify round-trip: encoding the decoded id should give back the cursor
    if (encodeCursor(decoded) !== cursor) {
      throw new Error('invalid cursor');
    }
    return decoded;
  } catch {
    throw new Error('invalid cursor');
  }
}
