async function test() {
  try {
    const login = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@hrsystem.com', password: 'password' })
    });
    const loginData = await login.json();
    const token = loginData.token;
    
    for (const tr of ['this_week', 'this_month', 'three_months']) {
      const res = await fetch(`http://localhost:3000/api/home?time_range=${tr}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      console.log(`[${tr}] data:`, JSON.stringify(data, null, 2));
    }
  } catch(e) {
    console.error(e);
  }
}
test();
