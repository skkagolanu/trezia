import { ImageResponse } from 'next/og';

export const alt = 'Trezia — apartment society maintenance and accounting software';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: '#FBE9D0',
          color: '#244855',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          justifyContent: 'center',
          padding: 72,
          width: '100%',
        }}
      >
        <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -3 }}>Trezia</div>
        <div style={{ fontSize: 34, marginTop: 24, textAlign: 'center' }}>
          Maintenance, dues, receipts, and accounting for apartment societies
        </div>
      </div>
    ),
    { ...size },
  );
}
