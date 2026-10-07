// Interactive CLI Prototype for Supplier Service CRUD & RBAC Demonstration
// Run via: npm run demo:interactive

import readline from 'node:readline';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import { buildApp } from '../dist/app.js';
import { InMemorySupplierRepository } from '../dist/db/repository.js';

// Terminal ANSI Styles
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  // 1. Setup in-memory keypair & tokens
  const keyPair = await generateKeyPair('RS256');
  const jwk = await exportJWK(keyPair.publicKey);
  jwk.kid = 'interactive-demo-key';
  jwk.alg = 'RS256';

  async function mintToken(name, roles) {
    return new SignJWT({
      preferred_username: name,
      email: `${name}@u.nus.edu`,
      realm_access: { roles },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'interactive-demo-key' })
      .setIssuer('http://localhost:8080/realms/campuserrand')
      .setExpirationTime('2h')
      .sign(keyPair.privateKey);
  }

  const adminToken = await mintToken('admin_demo', ['admin', 'user']);
  const studentToken = await mintToken('student_demo', ['user']);

  // Initial dummy state
  const repo = new InMemorySupplierRepository([
    {
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'Techno Edge Western',
      facilityType: 'Food',
      building: 'Techno Edge',
      floor: '1',
      locationDescription: 'Stall 2 near entrance',
      latitude: 1.2971,
      longitude: 103.7712,
      opensAt: '08:00',
      closesAt: '20:00',
      isActive: true,
      imageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'a0000000-0000-0000-0000-000000000002',
      name: 'NUS Co-op Central',
      facilityType: 'Shopping',
      building: 'Central Library',
      floor: '1',
      locationDescription: 'Inside CLB lobby',
      latitude: 1.2965,
      longitude: 103.7731,
      opensAt: '09:00',
      closesAt: '17:00',
      isActive: false, // Starts deactivated to demo soft delete
      imageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);

  const app = await buildApp({
    repository: repo,
    authConfig: {
      getJwksKeys: async () => [jwk],
      introspectFn: async () => ({ status: 200, body: { active: true } }),
    },
  });
  await app.ready();

  let currentRole = 'admin'; // 'admin' | 'student'
  let lastAction = 'Started interactive demo. Press any option below:';
  let lastResponse = null;

  async function execute(method, url, payload) {
    const token = currentRole === 'admin' ? adminToken : studentToken;
    const res = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    let parsed;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      parsed = res.body;
    }
    lastResponse = { status: res.statusCode, body: parsed };
    return res;
  }

  async function getSuppliersList() {
    const token = currentRole === 'admin' ? adminToken : studentToken;
    // Admins can see all (including deactivated); students only active
    const statusParam = currentRole === 'admin' ? 'all' : 'active';
    const res = await app.inject({
      method: 'GET',
      url: `/v1/suppliers?limit=10&status=${statusParam}`,
      headers: { authorization: `Bearer ${token}` },
    });
    try {
      return JSON.parse(res.body).data || [];
    } catch {
      return [];
    }
  }

  async function render() {
    process.stdout.write('\x1b[2J\x1b[H'); // Clear terminal screen
    console.log(bold(cyan('======================================================================')));
    console.log(bold(cyan('     FRIEND ON CAMPUS (FoC) - INTERACTIVE SUPPLIER CRUD & RBAC DEMO   ')));
    console.log(dim('     Direct HTTP Injection against Fastify with in-memory dummy database'));
    console.log(bold(cyan('======================================================================')));

    const roleBadge = currentRole === 'admin'
      ? bold(green('ADMIN [Full Write & Deactivated Access]'))
      : bold(yellow('STUDENT [Read-only, Active Only]'));
    console.log(`\nActive Persona: ${roleBadge}`);

    const suppliers = await getSuppliersList();
    console.log('\n' + bold('--- LIVE SUPPLIER DATABASE STATE ---'));
    if (suppliers.length === 0) {
      console.log(dim('  (No visible suppliers for current persona)'));
    } else {
      suppliers.forEach((s, idx) => {
        let statusBadge = s.isActive
          ? (s.isOpenNow ? green('[OPEN NOW]') : yellow('[CLOSED]'))
          : red('[DEACTIVATED - HIDDEN FROM STUDENTS]');
        console.log(`  ${bold(String(idx + 1))}. ${bold(s.name)} - ${cyan(s.facilityType)} @ ${s.building} ${statusBadge}`);
        console.log(`     ${dim(`ID: ${s.id} | Hours: ${s.opensAt} - ${s.closesAt} | Desc: ${s.locationDescription || '-'}`)}`);
      });
    }

    console.log('\n' + bold('--- LAST ACTION & API LOG ---'));
    console.log(`Event: ${bold(cyan(lastAction))}`);
    if (lastResponse) {
      const stColor = lastResponse.status >= 200 && lastResponse.status < 300 ? green : red;
      console.log(`HTTP Result: ${stColor(String(lastResponse.status))}`);
      console.log(`Payload:\n${dim(JSON.stringify(lastResponse.body, null, 2))}`);
    }

    console.log('\n' + bold(cyan('--- INTERACTIVE ACTIONS (Press number/letter) ---')));
    console.log(` [${bold('s')}] ${bold('Switch Persona')} (Current: ${currentRole.toUpperCase()})`);
    console.log(` [${bold('1')}] ${bold('Create')} new supplier ("The Deck Pasta")`);
    console.log(` [${bold('2')}] ${bold('Duplicate Create')} (Test 409 Case-insensitive constraint)`);
    console.log(` [${bold('3')}] ${bold('Search / Query')} (Search for "Western" at "Techno Edge")`);
    console.log(` [${bold('4')}] ${bold('Edit / Update')} (Modify hours & description of Stall 1)`);
    console.log(` [${bold('5')}] ${bold('Deactivate (Soft Delete)')} Stall 1`);
    console.log(` [${bold('6')}] ${bold('Reactivate')} Stall 1`);
    console.log(` [${bold('7')}] ${bold('Permanently Delete')} Stall 1`);
    console.log(` [${bold('q')}] ${bold('Quit')} demo`);
    console.log('----------------------------------------------------------------------');
    process.stdout.write(bold('Choose action: '));
  }

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  await render();

  process.stdin.on('keypress', async (_, key) => {
    if (key.ctrl && key.name === 'c' || key.name === 'q') {
      process.stdout.write('\n\nExiting interactive demo. Thank you!\n');
      await app.close();
      process.exit(0);
    }

    const currentList = await getSuppliersList();
    const target = currentList[0];

    switch (key.name) {
      case 's':
        currentRole = currentRole === 'admin' ? 'student' : 'admin';
        lastAction = `Switched persona to ${currentRole.toUpperCase()}`;
        lastResponse = null;
        break;

      case '1': {
        const stallName = `The Deck Pasta ${Math.floor(Math.random() * 900 + 100)}`;
        lastAction = `${currentRole.toUpperCase()} calls POST /v1/suppliers ("${stallName}")`;
        await execute('POST', '/v1/suppliers', {
          name: stallName,
          facilityType: 'Food',
          building: 'The Deck',
          floor: '2',
          locationDescription: 'Beside stairwell to LT27',
          opensAt: '09:00',
          closesAt: '20:30',
        });
        break;
      }

      case '2': {
        // Try creating duplicate of the first stall
        const dupName = target ? target.name.toLowerCase() : 'techno edge western';
        lastAction = `${currentRole.toUpperCase()} calls POST /v1/suppliers with duplicate name "${dupName}"`;
        await execute('POST', '/v1/suppliers', {
          name: dupName,
          facilityType: 'Food',
          building: 'Techno Edge',
          opensAt: '08:00',
          closesAt: '20:00',
        });
        break;
      }

      case '3': {
        lastAction = `${currentRole.toUpperCase()} calls GET /v1/suppliers?search=Western&building=Techno Edge`;
        await execute('GET', '/v1/suppliers?search=Western&building=Techno Edge&status=active');
        break;
      }

      case '4': {
        if (!target) {
          lastAction = 'No supplier available to edit!';
          break;
        }
        lastAction = `${currentRole.toUpperCase()} calls PATCH /v1/suppliers/${target.id}`;
        await execute('PATCH', `/v1/suppliers/${target.id}`, {
          locationDescription: `Renovated counter (Updated at ${new Date().toLocaleTimeString()})`,
          closesAt: '22:00',
        });
        break;
      }

      case '5': {
        if (!target) {
          lastAction = 'No supplier available to deactivate!';
          break;
        }
        lastAction = `${currentRole.toUpperCase()} calls PATCH /v1/suppliers/${target.id}/deactivate`;
        await execute('PATCH', `/v1/suppliers/${target.id}/deactivate`);
        break;
      }

      case '6': {
        if (!target) {
          lastAction = 'No supplier available to reactivate!';
          break;
        }
        lastAction = `${currentRole.toUpperCase()} calls PATCH /v1/suppliers/${target.id}/reactivate`;
        await execute('PATCH', `/v1/suppliers/${target.id}/reactivate`);
        break;
      }

      case '7': {
        if (!target) {
          lastAction = 'No supplier available to delete!';
          break;
        }
        lastAction = `${currentRole.toUpperCase()} calls DELETE /v1/suppliers/${target.id}`;
        await execute('DELETE', `/v1/suppliers/${target.id}`);
        break;
      }

      default:
        lastAction = `Key "${key.sequence || key.name}" not bound. Use [s, 1-7, q].`;
        break;
    }

    await render();
  });
}

main().catch(console.error);
