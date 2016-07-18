(function (
	CanvasWrapper,
	WebGLSupport
) {
	'use strict';

	var gooRunner = null;

	function setup(scene, loader) {
		// Application code goes here!

		/*
		 To get a hold of entities, one can use the World's selection functions:
		 var allEntities = gooRunner.world.getEntities();                  // all
		 var entity      = gooRunner.world.by.name('EntityName').first();  // by name
		 */
	}

	/**
	 * Entry point. Gets called after the script is loaded and displays the
	 * fallback if no WebGL is found, adds event listeners and starts loading
	 * the scene into the engine.
	 *
	 * @return {Promise}
	 */
	function init() {
		if (!checkForWebGLSupport()) { return; }

		// Init the GooEngine
		initGoo();
		var world = gooRunner.world;
		var renderer = gooRunner.renderer;

		preventBrowserInconsistencies();
		addButtonListeners();

		// Crazy hack to make orientation change work on the webview in iOS.
		goo.SystemBus.addListener('goo.viewportResize', function () {
			var dpx = gooRunner.renderer.devicePixelRatio;
			renderer.domElement.style.width = '1px';
			renderer.domElement.style.height = '1px';
			renderer.domElement.offsetHeight;
			renderer.domElement.style.width = '';
			renderer.domElement.style.height = '';
		});

		// Load the scene
		loadScene().then(function (loaderAndScene) {
			var loader = loaderAndScene.loader;
			var scene = loaderAndScene.scene;

			world.process();

			if (goo.Renderer.mainCamera) {
				renderer.checkResize(goo.Renderer.mainCamera);
			}

			return setup(scene, loader);
		}).then(function () {
			(new goo.EntityCombiner(world)).combine();
			world.process();
			return prepareMaterials();
		}).then(function () {
			show('canvas-screen');
			hide('loading-screen');
			CanvasWrapper.show();
			CanvasWrapper.resize();

			gooRunner.startGameLoop();

			renderer.domElement.focus();

		}).then(null, function (error) {
			// If something goes wrong, 'error' is the error message from the engine.
			console.error(error);
		});
	}

	/**
	 * Preloads the shaders used by the materials in the scene and then preloads
	 * those materials.
	 *
	 * @return {Promise}
	 */
	function prepareMaterials() {
		var renderer = gooRunner.renderer;
		var renderSystem = gooRunner.world.getSystem('RenderSystem');
		var entities = renderSystem._activeEntities;
		var lights = renderSystem.lights;

		return renderer.precompileShaders(entities, lights).then(function () {
			return renderer.preloadMaterials(entities);
		})
	}

	/**
	 * Initializes the Goo Engine and all the systems.
	 */
	function initGoo() {
		// Create typical Goo application.
		var params = {"alpha": false, "useDevicePixelRatio": true, "manuallyStartGameLoop": true, "antialias": true, "logo": false};
		params.logo = false // Handled in the html.
		gooRunner = new goo.GooRunner(params);

		var stateMachineSystem = new goo.StateMachineSystem(gooRunner);
		gooRunner.world
			.add(new goo.AnimationSystem())
			.add(stateMachineSystem)
			.add(new goo.HtmlSystem(gooRunner.renderer))
			.add(new goo.Dom3dSystem(gooRunner.renderer))
			.add(new goo.TimelineSystem())
			.add(new goo.PhysicsSystem())
			.add(new goo.ColliderSystem())
			.add(new goo.ParticleSystemSystem());

		stateMachineSystem.play();
	}

	/**
	 * Loads the scene.
	 *
	 * @return {Promise}
	 *         A promise which is resolved when the scene has finished loading.
	 */
	function loadScene() {
		// The dynamic loader takes care of loading the data.
		var loader = new goo.DynamicLoader({
			world: gooRunner.world,
			rootPath: 'res'
		});

		return loader.load('root.bundle').then(function(bundle) {
			var scene = getFirstSceneFromBundle(bundle);
			var alphaEnabled = false;

			// Disable all the skyboxes if the background is transparent.
			if (alphaEnabled) {
				Object.keys(bundle)
					.filter(function(k) { return /\.skybox$/.test(k); })
					.forEach(function(k) {
						var v = bundle[k];
						v.box.enabled = false;
					});
			}

			if (!scene || !scene.id) {
				console.error('Error: No scene in bundle'); // Should never happen.
				return null;
			}

			// Setup the canvas configuration (sizing mode, resolution, aspect
			// ratio, etc).
			var canvasConfig = scene ? scene.canvas : {};
			CanvasWrapper.setup(gooRunner.renderer.domElement, canvasConfig);
			CanvasWrapper.add();
			CanvasWrapper.hide();

			return loader.load(scene.id, {
				preloadBinaries: true,
				progressCallback: onLoadProgress
			})
			.then(function (scene) {
				return { scene: scene, loader: loader };
			});
		});
	}

	/**
	 * Gets the first scene from the specified bundle.
	 *
	 * @param {object} bundle
	 *        Bundle containing all the entities and assets in the scene.
	 *
	 * @return {object}
	 *         The configuration object of the first scene that was found in
	 *         the bundle.
	 */
	function getFirstSceneFromBundle(bundle) {
		function isSceneId(id) { return /\.scene$/.test(id); }

		for (var id in bundle) {
			if (isSceneId(id)) {
				return bundle[id];
			}
		}

		return null;
	}

	/**
	 * Callback for the loading screen.
	 *
	 * @param  {number} handled
	 * @param  {number} total
	 */
	function onLoadProgress(handled, total) {
		var loadedPercent = (100 * handled / total).toFixed();
		document.getElementById('progress').style.width = loadedPercent + '%';

		window.postMessage({handled: handled, total: total, loadedPercent: loadedPercent}, '*')
	}

	/**
	 * Adds an event listener to the buttons on the bottom bar.
	 */
	function addButtonListeners() {
		var maximizeButton = document.getElementById('maximize-button');
		maximizeButton.addEventListener('click', maximize);
		maximizeButton.addEventListener('touchstart', maximize);

		var muteButton = document.getElementById('mute-button');
		muteButton.addEventListener('click', toggleMute);
		muteButton.addEventListener('touchstart', toggleMute);
	}

	/**
	 * Requests the browser to go into fullscreen mode.
	 */
	function maximize() {
		var element = document.getElementById('canvas-outer');
		if (element.requestFullscreen) {
			element.requestFullscreen();
		} else if (element.msRequestFullscreen) {
			element.msRequestFullscreen();
		} else if (element.mozRequestFullScreen) {
			element.mozRequestFullScreen();
		} else if (element.webkitRequestFullscreen) {
			element.webkitRequestFullscreen();
		}
	}

	/**
	 * Mute sounds. Returns true if the new mute state is muted, and false otherwise.
	 */
	function toggleMute() {
		var soundSystem = gooRunner.world.getSystem('SoundSystem');
		var muteButton = document.getElementById('mute-button');
		if(soundSystem.muted){
			soundSystem.unmute();
			muteButton.classList.add('icon-sound');
			muteButton.classList.remove('icon-sound-mute');
		} else {
			soundSystem.mute();
			muteButton.classList.add('icon-sound-mute');
			muteButton.classList.remove('icon-sound');
		}
	}

	/**
	 * Prevent browser peculiarities from messing with our controls.
	 */
	function preventBrowserInconsistencies() {
		document.body.addEventListener('touchstart', function (event) {
			function isLink(el) { return el.nodeName === 'A'; }

			if (isLink(event.target)) { return; }

			var node = event.target.parentElement;
			for (var i = 0; i < 5; i++) {
				if (!node) { break; }
				if (isLink(node)) { return; }
				node = node.parentElement;
			}

			event.preventDefault();
		}, false);
	}

	/**
	 * Checks if WebGL is supported by the current browser and, if not, shows
	 * the fallback.
	 */
	function checkForWebGLSupport() {
		var errorObject = WebGLSupport.check();

		if (errorObject.error === WebGLSupport.ERRORS.NO_ERROR) {
			show('loading-screen');
			return true;
		} else {
			show('fallback');
			hide('loading-screen');
			return false;
		}
	}

	/**
	 * Converts camelCase (js) to dash-case (html)
	 */
	function camel2dash(str) {
		return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
	}

	function show(id) {
		var classList = document.getElementById(id).classList;
		classList.add('visible');
		classList.remove('hidden');
	}

	function hide(id) {
		var classList = document.getElementById(id).classList;
		classList.remove('visible');
		window.setTimeout(function () {
			classList.add('hidden');
		}, 500);
	}

	//--------------------------------------------------------------------------

	init();
})(CanvasWrapper, WebGLSupport);