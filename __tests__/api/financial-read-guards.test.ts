import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';

const routes: Record<string, readonly string[]> = {
  'src/app/api/fund-ledger/route.ts': ['POST', 'PATCH'],
  'src/app/api/advance-settlements/route.ts': ['POST', 'PATCH'],
  'src/app/api/opening-balances/route.ts': ['POST'],
  'src/app/api/bank-statement/route.ts': ['POST'],
  'src/app/api/bank-statement/[batchId]/route.ts': [],
  'src/app/api/payments/route.ts': ['POST', 'PATCH'],
  'src/app/api/bills/route.ts': ['POST', 'PATCH'],
  'src/app/api/balance-snapshots/route.ts': ['POST'],
};

function handlerBodies(route: string): Map<string, string> {
  const path = join(process.cwd(), route);
  // Every path is a fixed entry in the reviewed route contract above.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const handlers = new Map<string, string>();

  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      && statement.name
      && statement.body
      && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      handlers.set(statement.name.text, statement.body.getText(sourceFile));
    }
  }

  return handlers;
}

describe('financial route read guards', () => {
  it.each(Object.entries(routes))('%s uses the read guard only for GET', (route, writeMethods) => {
    const handlers = handlerBodies(route);
    const getBody = handlers.get('GET');

    expect(getBody).toBeDefined();
    expect(getBody).toMatch(/await\s+requireFinancialReader\s*\(/);
    expect(getBody).not.toMatch(/await\s+requireFinancialOperator\s*\(/);

    for (const method of writeMethods) {
      const writeBody = handlers.get(method);
      expect(writeBody).toBeDefined();
      expect(writeBody).toMatch(/await\s+requireFinancialOperator\s*\(/);
      expect(writeBody).not.toMatch(/await\s+requireFinancialReader\s*\(/);
    }
  });
});
