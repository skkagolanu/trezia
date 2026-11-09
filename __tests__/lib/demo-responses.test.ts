import { getDemoReply } from '@/lib/agent/demo-responses';

describe('getDemoReply', () => {
  it('answers a dues question with a total and flat count', () => {
    const reply = getDemoReply('who has pending dues?');
    expect(reply).toMatch(/flats have pending dues totalling ₹/);
  });

  it('answers a collections/expenses question with a net figure', () => {
    const reply = getDemoReply('what did we collect and spend this month?');
    expect(reply).toMatch(/collected ₹.*spent ₹.*net ₹/);
  });

  it('answers a balance question with a cash position', () => {
    const reply = getDemoReply('what is our cash balance?');
    expect(reply).toMatch(/Cash position/);
  });

  it('falls back to a generic demo explainer for anything else', () => {
    const reply = getDemoReply('tell me a joke');
    expect(reply).toMatch(/live demo/i);
  });
});
