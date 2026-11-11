
        // Override de SweetAlert2 per evitar que modifiqui l'alçada del body i provoqui salts de scroll al capdamunt
        if (typeof Swal !== 'undefined') {
            const _origSwalFire = Swal.fire;
            Swal.fire = function(...args) {
                if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
                    args[0].heightAuto = false;
                } else if (args.length > 0) {
                    let opts = { title: args[0], text: args[1], icon: args[2], heightAuto: false };
                    return _origSwalFire.call(Swal, opts);
                }
                return _origSwalFire.apply(Swal, args);
            };
        }

        // Anti-Parpadeig (FOUC): Apliquem classes ABANS de que es dibuixi la web
        if (localStorage.getItem('aliat_theme') === 'dark' || (!localStorage.getItem('aliat_theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark');
        }
        if (localStorage.getItem('aliat_token')) {
            document.documentElement.classList.add('is-logged-in');
        }
    