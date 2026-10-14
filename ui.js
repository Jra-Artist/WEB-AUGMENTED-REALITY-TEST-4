const NAV_SCREENS = ['screen-dashboard', 'screen-guide', 'screen-performance', 'screen-settings'];

// Screen router (also keeps the bottom nav highlight in sync)
function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');

    const bottomNav = document.getElementById('bottom-nav');
    const hideNav = ['screen-splash', 'screen-login', 'screen-ar'].includes(screenId);
    bottomNav.style.display = hideNav ? 'none' : 'flex';

    const idx = NAV_SCREENS.indexOf(screenId);
    document.querySelectorAll('.nav-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
}

function switchNav(screenId) {
    switchScreen(screenId);
}

// Simulated login (prototype only: any non-empty values pass)
function attemptLogin() {
    const email = document.getElementById('email-input').value;
    const pass = document.getElementById('password-input').value;

    if (email === "" || pass === "") {
        alert("Please enter your email and password to log in.");
        return;
    }
    document.getElementById('email-input').value = "";
    document.getElementById('password-input').value = "";
    switchScreen('screen-dashboard');
}

function attemptGoogleLogin() {
    alert("Google Authentication API will be integrated later.");
}
