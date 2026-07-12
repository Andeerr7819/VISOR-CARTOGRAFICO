document.addEventListener("DOMContentLoaded", () => {
    const introScreen = document.getElementById("intro-screen");
    const mainContent = document.getElementById("main-content");
    const btnContinue = document.getElementById("btn-continue");
    const canvas = document.getElementById("particle-canvas");
    const ctx = canvas.getContext("2d");

    // ==========================================================================
    // PORTADA ANIMADA DE FLUIDOS
    // ==========================================================================
    if (canvas && ctx) {
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;
        window.addEventListener("resize", () => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        });
        const particles = [];
        for (let i = 0; i < 40; i++) {
            particles.push({
                x: Math.random() * width, y: Math.random() * height,
                radius: Math.random() * 1.5 + 0.8,
                speedX: (Math.random() - 0.5) * 0.2, speedY: (Math.random() - 0.5) * 0.2,
                color: "rgba(34, 197, 94, 0.6)"
            });
        }
        function animate() {
            ctx.clearRect(0, 0, width, height);
            particles.forEach(p => {
                p.x += p.speedX; p.y += p.speedY;
                if (p.x < 0 || p.x > width) p.speedX *= -1;
                if (p.y < 0 || p.y > height) p.speedY *= -1;
                ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
            });
            requestAnimationFrame(animate);
        }
        animate();
    }

    if (btnContinue) {
        btnContinue.addEventListener("click", () => {
            introScreen.classList.add("fade-out");
            mainContent.classList.remove("hidden");
            document.body.style.overflow = "auto";
            setTimeout(() => { initializeCoreSIG(); }, 100);
        });
    }

    // ==========================================================================
    // CONVERTIDOR MATEMÁTICO INTEGRAL: REPARA COORDENADAS UTM
    // ==========================================================================
    function corregirPuntoUTM(x, y, zona = 17) {
        if (Math.abs(x) < 180 && Math.abs(y) < 180) return [y, x];

        const a = 6378137.0; 
        const f = 1.0 / 298.257223563;
        const b = a * (1.0 - f);
        const e2 = (a*a - b*b) / (a*a);
        const ePrime2 = (a*a - b*b) / (b*b);
        
        const k0 = 0.9996;
        const falseEasting = 500000.0;
        const falseNorthing = 10000000.0; 
        
        const x_coord = x - falseEasting;
        const y_coord = y - falseNorthing;

        const M = y_coord / k0;
        const mu = M / (a * (1.0 - e2/4.0 - 3.0*e2*e2/64.0 - 5.0*Math.pow(e2,3)/256.0));
        
        const e1 = (1.0 - Math.sqrt(1.0 - e2)) / (1.0 + Math.sqrt(1.0 - e2));
        const j1 = (3.0 * e1 / 2.0 - 27.0 * Math.pow(e1, 3.0) / 32.0);
        const j2 = (21.0 * e1 * e1 / 16.0 - 55.0 * Math.pow(e1, 4.0) / 32.0);
        const j3 = (151.0 * Math.pow(e1, 3.0) / 96.0);
        
        const fp = mu + j1*Math.sin(2.0*mu) + j2*Math.sin(4.0*mu) + j3*Math.sin(6.0*mu);
        
        const C1 = ePrime2 * Math.pow(Math.cos(fp), 2.0);
        const T1 = Math.pow(Math.tan(fp), 2.0);
        const R1 = a * (1.0 - e2) / Math.pow(1.0 - e2 * Math.pow(Math.sin(fp), 2.0), 1.5);
        const N1 = a / Math.sqrt(1.0 - e2 * Math.pow(Math.sin(fp), 2.0));
        const D = x_coord / (N1 * k0);

        let lat = fp - (N1 * Math.tan(fp) / R1) * (D*D/2.0 - (5.0 + 3.0*T1 + 10.0*C1)*Math.pow(D, 4.0)/24.0);
        let lon = (D - (1.0 + 2.0*T1 + C1)*Math.pow(D, 3.0)/6.0) / Math.cos(fp);

        lat = lat * 180.0 / Math.PI;
        lon = (lon * 180.0 / Math.PI) + ((zona === 18) ? -75.0 : -81.0);

        return [lat, lon];
    }

    function normalizarGeometriaGeoJSON(geojson) {
        if (!geojson || !geojson.features) return geojson;
        
        geojson.features.forEach(feature => {
            if (!feature.geometry || !feature.geometry.coordinates) return;
            
            let primeraX = 0;
            try {
                let coords = feature.geometry.coordinates;
                while (Array.isArray(coords[0])) coords = coords[0];
                primeraX = coords[0];
            } catch(e){}
            
            let zonaEstimada = (primeraX > 750000 || primeraX < 200000) ? 18 : 17;

            const transformarCoordenadas = (coords) => {
                if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
                    const corregido = corregirPuntoUTM(coords[0], coords[1], zonaEstimada);
                    coords[0] = corregido[1];
                    coords[1] = corregido[0];
                } else {
                    coords.forEach(transformarCoordenadas);
                }
            };
            transformarCoordenadas(feature.geometry.coordinates);
        });
        return geojson;
    }

    // ==========================================================================
    // MOTOR DE CONTROL PRINCIPAL SIG CORE
    // ==========================================================================
    function initializeCoreSIG() {
        const map = L.map('map', { zoomControl: false }).setView([-2.90, -78.96], 10);
        L.control.zoom({ position: 'topleft' }).addTo(map);

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png').addTo(map);

        let proyectosCargados = {};
        let capasMapaActual = [];
        let capasEstadoIA = {};

        const cityStatusContainer = document.getElementById("city-status-list");
        const themesListContainer = document.getElementById("themes-list");
        const aiRealtimeReport = document.getElementById("ai-realtime-report");
        const fileInput = document.getElementById("input-zip-upload");
        const adminUploadZone = document.getElementById("admin-upload-zone");
        const btnToggleAdmin = document.getElementById("btn-toggle-admin");

        if (btnToggleAdmin) {
            btnToggleAdmin.addEventListener("click", () => {
                adminUploadZone.classList.toggle("hidden");
                btnToggleAdmin.classList.toggle("active-admin");
            });
        }

        actualizarCatalogoVisual();

        function actualizarCatalogoVisual() {
            cityStatusContainer.innerHTML = "";
            const keys = Object.keys(proyectosCargados);
            
            if (keys.length === 0) {
                cityStatusContainer.innerHTML = `
                    <div style="color: #64748b; font-size: 0.75rem; text-align: center; padding: 15px; border: 1px dashed rgba(255,255,255,0.05); border-radius: 6px;">
                        <i class="fa-solid fa-folder-open" style="margin-bottom: 4px; display:block; opacity:0.5;"></i> Servidor listo. Inyecta el .ZIP desde el Modo Admin.
                    </div>
                `;
                return;
            }

            keys.forEach(key => {
                const proj = proyectosCargados[key];
                const cardHtml = `
                    <div class="city-status-card" style="background: rgba(34, 197, 94, 0.03); border-color: rgba(34, 197, 94, 0.15); padding: 12px; border-radius: 8px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; border: 1px solid;">
                        <div>
                            <h4 style="color: white; font-size: 0.85rem; margin: 0; font-weight:600;">${proj.nombre}</h4>
                            <span style="color: #22c55e; font-size: 0.7rem; display: flex; align-items: center; gap: 4px; margin-top: 3px;">
                                <span style="background: #22c55e; width: 6px; height: 6px; display: inline-block; border-radius: 50%;"></span>
                                Cartografía Activa
                            </span>
                        </div>
                        <button class="select-city" data-key="${key}" style="background: #22c55e; color: white; border: 0; padding: 4px 10px; border-radius: 4px; font-size: 0.7rem; cursor: pointer; font-weight:600;"><i class="fa-solid fa-eye"></i> Ver</button>
                    </div>
                `;
                cityStatusContainer.insertAdjacentHTML('beforeend', cardHtml);
            });

            document.querySelectorAll(".select-city").forEach(btn => {
                btn.addEventListener("click", () => { desplegarProyectoEnMapa(btn.dataset.key); });
            });
        }

        if (fileInput) {
            fileInput.addEventListener("change", function(e) {
                const file = e.target.files[0];
                if (!file) return;

                themesListContainer.innerHTML = `
                    <div style="color: #94a3b8; font-size: 0.85rem; text-align: center; padding: 25px;">
                        <i class="fa-solid fa-compress fa-spin" style="color: #22C55E; font-size: 1.6rem; margin-bottom: 12px;"></i>
                        <p style="margin:0; font-weight:500;">Procesando y alineando capas espaciales...</p>
                    </div>
                `;

                const reader = new FileReader();
                reader.onload = function(event) {
                    JSZip.loadAsync(event.target.result).then(async function(zip) {
                        let mapaVectoresAgrupados = {};
                        let capasFinalesUnificadas = [];
                        let nombreTerritorio = "PROYECTO TERRITORIAL - AZUAY";

                        for (let path in zip.files) {
                            const entry = zip.files[path];
                            if (entry.dir) continue;

                            const filename = path.split('/').pop();
                            
                            if (filename.endsWith('.js')) {
                                const text = await entry.async("string");
                                const cleanJson = text.replace(/^var\s+json_\w+\s*=\s*/, '').replace(/;\s*$/, '');
                                
                                try {
                                    let geojson = JSON.parse(cleanJson);
                                    geojson = normalizarGeometriaGeoJSON(geojson);

                                    let temaDestino = "DIVISIÓN TERRITORIAL";
                                    let rawUpper = filename.toUpperCase();

                                    if (rawUpper.includes("RIOS") || rawUpper.includes("HIDRO") || rawUpper.includes("DRENAJE")) temaDestino = "SISTEMA HIDROGRÁFICO";
                                    else if (rawUpper.includes("VIAL") || rawUpper.includes("VIAS") || rawUpper.includes("RED")) temaDestino = "RED VIAL PRINCIPAL";
                                    else if (rawUpper.includes("AREAS") || rawUpper.includes("PROTEGIDAS") || rawUpper.includes("BOSQUE")) temaDestino = "ÁREAS PROTEGIDAS";
                                    else if (rawUpper.includes("PARROQ")) temaDestino = "PARROQUIAS RURALES";
                                    else if (rawUpper.includes("POBLADOS") || rawUpper.includes("CENTROS")) temaDestino = "CENTROS POBLADOS";

                                    if (!mapaVectoresAgrupados[temaDestino]) {
                                        mapaVectoresAgrupados[temaDestino] = geojson;
                                    } else {
                                        mapaVectoresAgrupados[temaDestino].features = mapaVectoresAgrupados[temaDestino].features.concat(geojson.features);
                                    }
                                } catch(err) { console.log("Filtro vector."); }
                            }

                            if (filename.endsWith('.png') || filename.endsWith('.jpg')) {
                                if (filename.includes("tierra-espacio") || filename.includes("silueta-mundo")) continue;

                                const blob = await entry.async("blob");
                                const base64 = await new Promise(res => {
                                    const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blob);
                                });

                                let rawUpper = filename.toUpperCase();
                                let temaNombreFormal = `RÁSTER - ANÁLISIS DE COBERTURAS`;
                                
                                if (rawUpper.includes("COBERTURA") || rawUpper.includes("SUELO")) temaNombreFormal = "RÁSTER - USO DE SUELO NATIVO";
                                else if (rawUpper.includes("TEMPERATURA") || rawUpper.includes("TERMICO")) temaNombreFormal = "RÁSTER - COMPOSTURA TÉRMICA";
                                else if (rawUpper.includes("PENDIENTE")) temaNombreFormal = "RÁSTER - ANÁLISIS DE PENDIENTES";
                                else if (rawUpper.includes("MDT") || rawUpper.includes("ELEVACION")) temaNombreFormal = "RÁSTER - MODELO DE ELEVACIÓN (MDT)";

                                capasFinalesUnificadas.push({ type: "raster", name: temaNombreFormal, data: base64 });
                            }
                        }

                        for (let nombreTema in mapaVectoresAgrupados) {
                            capasFinalesUnificadas.push({
                                type: "vector",
                                name: nombreTema,
                                data: mapaVectoresAgrupados[nombreTema]
                            });
                        }

                        const proyectoKey = "proj_" + Date.now();
                        proyectosCargados[proyectoKey] = {
                            nombre: nombreTerritorio,
                            capas: capasFinalesUnificadas
                        };

                        actualizarCatalogoVisual();
                        desplegarProyectoEnMapa(proyectoKey);

                    }).catch(err => { console.error(err); });
                };
                reader.readAsArrayBuffer(file);
            });
        }

        // ==========================================================================
        // ACOPLE GEOGRÁFICO AJUSTADO EN EL AZUAY (ANCLAJE ESTABLE)
        // ==========================================================================
        function desplegarProyectoEnMapa(key) {
            capasMapaActual.forEach(l => map.removeLayer(l));
            capasMapaActual = [];
            capasEstadoIA = {};
            themesListContainer.innerHTML = "";

            const proyecto = proyectosCargados[key];
            let idx = 0;

            const vectores = proyecto.capas.filter(c => c.type === "vector");
            const rasters = proyecto.capas.filter(c => c.type === "raster");

            // Matriz de límites estricta de Azuay para evitar desbordes por ceros aislados
            const recuadroEstableAzuay = L.latLngBounds([-3.42, -79.62], [-2.72, -78.38]);

            vectores.forEach((capa) => {
                idx++;
                const hue = (idx * 155) % 360;
                const layerColor = `hsl(${hue}, 90%, 55%)`;
                capasEstadoIA[capa.name] = true;

                const mapLayer = L.geoJSON(capa.data, {
                    style: function(feature) {
                        const type = feature.geometry ? feature.geometry.type : "";
                        if (type.includes("LineString") || capa.name.includes("HIDRO") || capa.name.includes("VIAL")) {
                            return { color: layerColor, weight: 1.6, opacity: 0.9, fill: false, fillColor: 'none' };
                        }
                        return { fillColor: layerColor, color: layerColor, weight: 1, fillOpacity: 0.20 };
                    },
                    onEachFeature: function(feature, layer) {
                        if (feature.properties) {
                            let p = `<div style="color:#cbd5e1; font-size:0.75rem; max-height:120px; overflow-y:auto;">`;
                            for(let k in feature.properties) { p += `<b>${k}:</b> ${feature.properties[k]}<br>`; }
                            layer.bindPopup(p + "</div>");
                        }
                    }
                }).addTo(map);

                capasMapaActual.push(mapLayer);
                inyectarTarjetaControl(capa.name, layerColor, mapLayer, idx, false);
            });

            // ACOPLE MILIMÉTRICO INMUNE: Forzamos la superposición ráster exactamente en el bloque estable de Azuay
            rasters.forEach((capa) => {
                idx++;
                capasEstadoIA[capa.name] = true;

                const rasterLayer = L.imageOverlay(capa.data, recuadroEstableAzuay, { opacity: 0.65 }).addTo(map);
                capasMapaActual.push(rasterLayer);

                inyectarTarjetaControl(capa.name, "#14b8a6", rasterLayer, idx, true);
            });

            map.setView([-2.90, -78.96], 10);
            map.invalidateSize();

            procesarAnaliticaIAAutomática();
        }

        function inyectarTarjetaControl(nombre, color, layerInstance, id, isRaster) {
            const icon = isRaster ? "fa-image" : (nombre.includes("VIAL") || nombre.includes("HIDRO") ? "fa-route" : "fa-draw-polygon");
            const cardHtml = `
                <div class="layer-item qgis-card" id="card-layer-${id}" style="background: rgba(255,255,255,0.02); padding: 11px 14px; border-radius: 8px; margin-bottom: 6px; cursor: pointer; border: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 10px; max-width: 80%;">
                        <span style="background: ${color}; width: 10px; height: 10px; display: inline-block; border-radius: 50%; box-shadow: 0 0 8px ${color};"></span>
                        <h5 style="color: white; font-size: 0.8rem; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><i class="fa-solid ${icon}" style="opacity:0.4; font-size:0.7rem; margin-right:4px;"></i>${nombre}</h5>
                    </div>
                    <input type="checkbox" id="chk-layer-${id}" checked style="accent-color: #22C55E; cursor: pointer;">
                </div>
            `;
            themesListContainer.insertAdjacentHTML('beforeend', cardHtml);

            document.getElementById(`chk-layer-${id}`).addEventListener('change', (e) => {
                e.stopPropagation();
                if (e.target.checked) {
                    map.addLayer(layerInstance);
                    capasEstadoIA[nombre] = true;
                } else {
                    map.removeLayer(layerInstance);
                    capasEstadoIA[nombre] = false;
                }
                procesarAnaliticaIAAutomática();
            });

            document.getElementById(`card-layer-${id}`).addEventListener('click', () => {
                map.setView([-2.90, -78.96], 10);
            });
        }

        function procesarAnaliticaIAAutomática() {
            let report = "";
            let totalActivas = Object.values(capasEstadoIA).filter(v => v === true).length;

            if (totalActivas === 0) {
                aiRealtimeReport.innerHTML = `<p style="color: #64748b; font-size:0.75rem; margin:0; text-align:center;">Lienzo vacío. Prende mapas para activar la IA.</p>`;
                return;
            }

            let v = capasEstadoIA;
            let tieneVias = v["RED VIAL PRINCIPAL"];
            let tieneAreas = v["ÁREAS PROTEGIDAS"];
            let tieneTermico = v["RÁSTER - COMPOSTURA TÉRMICA"];
            let tieneSuelo = v["RÁSTER - USO DE SUELO NATIVO"];
            let tienePendientes = v["RÁSTER - ANÁLISIS DE PENDIENTES"];
            let tieneMdt = v["RÁSTER - MODELO DE ELEVACIÓN (MDT)"];
            let tieneHidro = v["SISTEMA HIDROGRÁFICO"];

            let crucesEncontrados = 0;

            if (tieneVias && tieneAreas) {
                report += `• <b>Fragmentación de Hábitats:</b> Red vial cruza zonas de reserva biológica. Riesgo alto de pérdida de conectividad vegetal estructural.<br>`;
                crucesEncontrados++;
            }
            if (tieneTermico && tieneSuelo) {
                report += `• <b>Anomalías Térmicas:</b> Concentración de calor sobre suelos desnudos/pastizales, contrastando con la regulación climática forestal.<br>`;
                crucesEncontrados++;
            }
            if (tienePendientes && tieneMdt) {
                report += `• <b>Dinámica de Laderas:</b> Inclinaciones críticas mapeadas en el MDT marcan zonas de escorrentía súbita y remoción en masa.<br>`;
                crucesEncontrados++;
            }
            if (tieneHidro && tieneVias) {
                report += `• <b>Presión Antrópica:</b> Proximidad de ejes de drenaje vial a cuerpos de agua incrementa arrastre de precursores contaminantes.<br>`;
                crucesEncontrados++;
            }

            if (totalActivas >= 4) {
                report += `• <b>Modelamiento de Síntesis:</b> Superposición múltiple simula un escenario de <b>Vulnerabilidad Territorial Media-Alta</b>. Urge planificar corredores verdes ecológicos.`;
                crucesEncontrados++;
            }

            if (crucesEncontrados === 0) {
                report = `• <b>Lectura Cartográfica Base:</b> Evaluando variables aisladas. Prende más mapas vectoriales o rásters combinados para iniciar las correlaciones espaciales automáticas.`;
            }

            aiRealtimeReport.innerHTML = `<div style="color: #4ade80; font-weight:600; font-size:0.7rem; margin-bottom:4px; text-transform:uppercase;">Modelando ${totalActivas} temas en vivo:</div><div style="font-size:0.75rem; color:#e2e8f0; line-height:1.4;">${report}</div>`;
        }

        document.getElementById('btn-zoom-provincia').addEventListener('click', () => {
            map.setView([-2.90, -78.96], 10);
        });

        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                tabButtons.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });
    }
});
