async function run() {
  try {
    const res = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'manager.roma@fusarouomo.com', password: 'password123' })
    });
    const data = await res.json() as any;
    console.log("Login:", data);
    
    if (data.data?.token) {
      const res2 = await fetch('http://localhost:3000/api/leave/97/approve', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${data.data.token}`
        },
        body: JSON.stringify({ notes: "Okay" })
      });
      const data2 = await res2.json() as any;
      console.log("Approve:", data2);
    }
  } catch (err) {
    console.error(err);
  }
}
run();
