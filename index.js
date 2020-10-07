var exportObject = {
    internal : {
        memory : null,
        malloc : null,
        free : null,
        call : null,
    },
    allocateString : (s) => {
        if (exportObject.internal.memory == null)
        {
            return null;
        }

        var encoded = exportObject.utf8encoder.encode(s);

        var offset = exportObject.internal.malloc(encoded.length + 1);

        exportObject.internal.memory.set(encoded, offset)
        exportObject.internal.memory[offset + encoded.length + 1] = 0;

        return {
            start : offset,
            size : encoded.length + 1
        };
    },
    freeString : (str) => {
        if (exportObject.internal.memory == null)
        {
            return;
        }

        if (str == null)
        {
            return null;
        }

        exportObject.internal.free(str.start);
    },
    utf8decoder: new TextDecoder("utf-8"),
    utf8encoder: new TextEncoder(),
    getString : (offset) => {
        /* TODO: adapt https://aransentin.github.io/cwasm/ */
        /*
            let utf8decoder = new TextDecoder( "utf-8" );

            [...]

            function console_log( str, len ){
                let arr = memory.subarray( str, str+len );
                console.log( utf8decoder.decode( arr ) );
            }
        */

        if (exportObject.internal.memory == null)
        {
            return "";
        }

        if (offset == 0)
        {
            return null;
        }

        let offset2 = offset;
        while (exportObject.internal.memory[offset2] != 0) {
            offset2++;
        }
        return exportObject.utf8decoder.decode(exportObject.internal.memory.subarray(offset, offset2));
    },
    getCallbackBuffer : () => {
        var addr = exportObject.internal.get_callback_buffer();
        return new Int32Array(exportObject.internal.buffer, addr, 10);
    }
};

var wasm_callbacks = {}
// reserve indexes -1,0,1,2 for use as constants
var wasm_object = [null, true, false]
var wasm_object_freelist = []

function save_wasm_object(v) {
    if (v === null) { return 0; }
    if (v === undefined) { return -1; }
    if (v === true) { return 1; }
    if (v === false) { return 2; }
    if (wasm_object_freelist.length === 0)
    {
        return wasm_object.push(v) - 1;
    }
    else
    {
        var i = wasm_object_freelist.pop();
        wasm_object[i] = v;
        return i;
    }
}
function free_wasm_object(_id) {
    if (_id > 2) {
        wasm_object[_id] = null;
        wasm_object_freelist.push(_id);
    }
}

var importObject = {
    env: {
        abort : (_err) => { 
            var msg = exportObject.getString(_err);
            debugger;
            //alert(msg);
        },
        log : (_str) => {
            console.log(exportObject.getString(_str));
        },
        add_css_link: (_filename) => {
            var head = document.getElementsByTagName('head')[0];
            var style = document.createElement('link');
            style.href = exportObject.getString(_filename);
            style.type = 'text/css';
            style.rel = 'stylesheet';
            head.append(style);
        },
        append_html : (_id, _html) => {
            var id = exportObject.getString(_id);
            var html = exportObject.getString(_html);
            document.getElementById(id).innerHTML += html;
        },
        set_innerhtml: (_id, _html) => {
            var id = exportObject.getString(_id);
            var html = exportObject.getString(_html);
            document.getElementById(id).innerHTML = html;
        },
        memory_set: (_id, offset) => {
            exportObject.internal.memory.set(wasm_object[_id], offset);
        },
        object_set_innerhtml: (_id, _html) => {
            wasm_object[_id].innerHTML = exportObject.getString(_html);
        },
        object_set_property: (_id, _prop, _id2) => {
            wasm_object[_id][exportObject.getString(_prop)] = wasm_object[_id2];
        },
        object_get_property: (_id, _prop) => {
            return save_wasm_object(wasm_object[_id][exportObject.getString(_prop)]);
        },
        object_get_integer_property: (_id, _prop) => {
            return wasm_object[_id][exportObject.getString(_prop)];
        },
        object_from_string: (_text) => {
            return save_wasm_object(exportObject.getString(_text));
        },
        object_allocate_string: (_id) => {
            return exportObject.allocateString(wasm_object[_id]).start;
        },
        object_json_parse: (_id) => {
            return save_wasm_object(JSON.parse(wasm_object[_id]));
        },
        object_json_stringify: (_id) => {
            return save_wasm_object(JSON.stringify(wasm_object[_id]));
        },
        object_get_document: (_id) => {
            return save_wasm_object(document);
        },
        object_get_window: (_id) => {
            return save_wasm_object(window);
        },
        object_get_history: (_id) => {
            return save_wasm_object(history);
        },
        object_btoa: (_id) => {
            return save_wasm_object(btoa(wasm_object[_id]));
        },
        object_atob: (_id) => {
            return save_wasm_object(atob(wasm_object[_id]));
        },
        new_rtcpeerconnection: (_id) => {
            return save_wasm_object(new RTCPeerConnection(wasm_object[_id]));
        },
        new_urlsearchparams: (_id) => {
            return save_wasm_object(new URLSearchParams(wasm_object[_id]));
        },
        remove_element : (_id) => {
            var id = exportObject.getString(_id);
            var element = document.getElementById(id);
            element.parentNode.removeChild(element);
        },
        get_value : (_id) => {
            var id = exportObject.getString(_id);
            value = document.getElementById(id).value;
            return exportObject.allocateString(value).start;
        },
        set_value : (_id, _value) => {
            var id = exportObject.getString(_id);
            document.getElementById(id).value = exportObject.getString(_value);
        },
        register_callback_token: (i, _func, _ctx) => {
            wasm_callbacks[i] = [_func, _ctx]
        },
        convert_callback_to_object: (_cb) => {
            return save_wasm_object((event) => {
                var event_buffer = exportObject.getCallbackBuffer();
                var x = save_wasm_object(event);
                event_buffer[0] = x;
                callwasm(_cb);
                free_wasm_object(x);
            });
        },
        deregister_callback_token: (i) => {
            delete wasm_callbacks[i];
        },
        fetch: (_method, _url, _payload, _content, _auth, i) => {
            var method = exportObject.getString(_method);
            var url = exportObject.getString(_url);
            var content = exportObject.getString(_content);
            var auth = exportObject.getString(_auth);

            var options = {
                method: method,
                mode: 'cors',
                headers: {
                    "Content-Type": content,
                    "Authorization": auth
                }
            };

            if (_payload != 0)
            {
                var payload = exportObject.getString(_payload);
                options.body = payload;
            }

            fetch(url, options).then(function(response) {
                response.text().then(function(value) {
                    var native_value = exportObject.allocateString(value);
                    exportObject.internal.callback(i, native_value.start);
                    exportObject.freeString(native_value);
                });
            });
        },
        get_cookies: () => {
            return exportObject.allocateString(document.cookie).start
        },
        write_cookie: (_cookie) => {
            document.cookie = exportObject.getString(_cookie);
        },
        document_create_element: (_string) => {
            return save_wasm_object(document.createElement(exportObject.getString(_string)));
        },
        document_get_element_by_id: (_string) => {
            return save_wasm_object(document.getElementById(exportObject.getString(_string)));
        },
        object_add_class: (_id, _text) => {
            wasm_object[_id].classList.add(exportObject.getString(_text));
        },
        object_remove_class: (_id, _text) => {
            wasm_object[_id].classList.remove(exportObject.getString(_text));
        },
        object_append_child: (_node, _newnode) => {
            wasm_object[_node].appendChild(wasm_object[_newnode]);
        },
        object_remove_child: (_node, _newnode) => {
            wasm_object[_node].removeChild(wasm_object[_newnode]);
        },
        object_set_attribute: (_node, _attr, _value) => {
            wasm_object[_node].setAttribute(exportObject.getString(_attr), exportObject.getString(_value));
        },
        object_replace_child: (_node, _newnode, _existing) => {
            wasm_object[_node].replaceChild(wasm_object[_newnode], wasm_object[_existing]);
        },
        object_insert_before: (_node, _newnode, _existing) => {
            wasm_object[_node].insertBefore(wasm_object[_newnode], wasm_object[_existing]);
        },
        object_get_bounding_client_rect: (_node, _addr_x, _addr_y, _addr_w, _addr_h) => {
            let rect = wasm_object[_node].getBoundingClientRect();
            var i = exportObject.internal.memory32;
            var f = exportObject.internal.memoryf32;
            f[_addr_x >> 2] = rect.x;
            f[_addr_y >> 2] = rect.y;
            i[_addr_w >> 2] = rect.width;
            i[_addr_h >> 2] = rect.height;
        },
        object_add_event_listener: (_node, _eventname, _obj) => {
            wasm_object[_node].addEventListener(exportObject.getString(_eventname), wasm_object[_obj]);
        },
        object_equals: (_id1, _id2) => {
            return wasm_object[_id1] === wasm_object[_id2];
        },
        object_copy: (_id) => {
            return save_wasm_object(wasm_object[_id]);
        },
        jscall_call_o: (_id, _a1) => {
            return save_wasm_object(wasm_object[_id].call(wasm_object[_a1]));
        },
        jscall_call_oo: (_id, _a1, _a2) => {
            return save_wasm_object(wasm_object[_id].call(wasm_object[_a1], wasm_object[_a2]));
        },
        jscall_call_ooo: (_id, _a1, _a2, _a3) => {
            return save_wasm_object(wasm_object[_id].call(wasm_object[_a1], wasm_object[_a2], wasm_object[_a3]));
        },
        jscall_call_oooo: (_id, _a1, _a2, _a3, _a4) => {
            return save_wasm_object(wasm_object[_id].call(wasm_object[_a1], wasm_object[_a2], wasm_object[_a3], wasm_object[_a4]));
        },
        jscall_object: (_id) => {
            return save_wasm_object(wasm_object[_id]());
        },
        jscall_object_o: (_id, _a1) => {
            return save_wasm_object(wasm_object[_id](wasm_object[_a1]));
        },
        jscall_object_oo: (_id, _a1, _a2) => {
            return save_wasm_object(wasm_object[_id](wasm_object[_a1], wasm_object[_a2]));
        },
        jscall_object_ooo: (_id, _a1, _a2, _a3) => {
            return save_wasm_object(wasm_object[_id](wasm_object[_a1], wasm_object[_a2], wasm_object[_a3]));
        },
        jscall_object_oooo: (_id, _a1, _a2, _a3, _a4) => {
            return save_wasm_object(wasm_object[_id](wasm_object[_a1], wasm_object[_a2], wasm_object[_a3], wasm_object[_a4]));
        },
        jscall_object_i32: (_id, i) => {
            return save_wasm_object(wasm_object[_id](i));
        },
        jscall_object_f32: (_id, i) => {
            return save_wasm_object(wasm_object[_id](i));
        },
        new_array: () => {
            return save_wasm_object([]);
        },
        free_object: free_wasm_object,
        object_get_context: (_id, _text) => { return save_wasm_object(wasm_object[_id].getContext(exportObject.getString(_text))); },
        object_parent_node: (_id) => { return save_wasm_object(wasm_object[_id].parentNode); },
        canvas_get_extents: (_id, _addr) => {
            var i = exportObject.internal.memory32;
            var c = wasm_object[_id];
            i[_addr >> 2] = c.width;
            i[(_addr >> 2) + 1] = c.height;
        },
        canvas_set_extents: (_id, width, height) => { wasm_object[_id].width = width; wasm_object[_id].height = height; },
        window_device_pixel_ratio: () => { return window.devicePixelRatio; },
        context_scale: (_id, x, y) => { wasm_object[_id].scale(x, y); },
        context_fill_style: (_id, _text) => { wasm_object[_id].fillStyle = exportObject.getString(_text); },
        context_stroke_style: (_id, _text) => { wasm_object[_id].strokeStyle = exportObject.getString(_text); },
        context_line_width: (_id, width) => { wasm_object[_id].lineWidth = width; },
        context_font: (_id, _text) => { wasm_object[_id].font = exportObject.getString(_text); },
        context_stroke_rect: (_id, x, y, w, h) => { wasm_object[_id].strokeRect(x,y,w,h); },
        context_fill_rect: (_id, x, y, w, h) => { wasm_object[_id].fillRect(x,y,w,h); },
        context_fill_text: (_id, _text, x, y) => { wasm_object[_id].fillText(exportObject.getString(_text),x,y); },
        context_begin_path: (_id) => { wasm_object[_id].beginPath(); },
        context_line_to: (_id, x, y) => { wasm_object[_id].lineTo(x,y); },
        context_move_to: (_id, x, y) => { wasm_object[_id].moveTo(x,y); },
        context_stroke: (_id) => { wasm_object[_id].stroke(); },
        on_frame: (_cb) => { var f = (event) => { callwasm(_cb); requestAnimationFrame(f); }; f(); },
        add_mouse_touch_event_listeners: (_id, _cbmouse, _cbtouch) => {
            (function(){
                var canvas = wasm_object[_id];

                var getMouseCallback = (code) => {
                    return (event) => {
                        var rect = canvas.getBoundingClientRect();

                        var event_buffer = exportObject.getCallbackBuffer();
                        event_buffer[0] = code;
                        event_buffer[1] = event.clientX - rect.x;
                        event_buffer[2] = event.clientY - rect.y;
                        callwasm(_cbmouse);

                        event.preventDefault();
                    };
                };
                canvas.addEventListener('mouseenter', getMouseCallback(0));
                canvas.addEventListener('mouseleave', getMouseCallback(1));
                canvas.addEventListener('mousemove', getMouseCallback(2));
                canvas.addEventListener('mousedown', getMouseCallback(3));
                canvas.addEventListener('mouseup', getMouseCallback(4));

                var getTouchCallback = (code) => {
                    return (event) => {
                        var rect = canvas.getBoundingClientRect();
                        var touches = event.changedTouches;

                        var event_buffer = exportObject.getCallbackBuffer();
                        for (var i = 0; i < touches.length; i++) {
                            var touch = touches[i];
                            event_buffer[0] = code;
                            event_buffer[1] = touch.identifier
                            event_buffer[2] = touch.pageX - rect.x;
                            event_buffer[3] = touch.pageY - rect.y;
                            callwasm(_cbtouch);
                        }

                        event.preventDefault();
                    };
                };
                canvas.addEventListener('touchstart', getTouchCallback(1));
                canvas.addEventListener('touchend', getTouchCallback(2));
                canvas.addEventListener('touchmove', getTouchCallback(0));
                canvas.addEventListener('touchcancel', getTouchCallback(2));
            }())
        },
        glclearColor: (_id, r, g, b, a) => { wasm_object[_id].clearColor(r,g,b,a); },
        glclearDepth: (_id, d) => { wasm_object[_id].clearDepth(d); },
        glclearBuffer: (_id) => {
            var gl = wasm_object[_id];
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        },
        glcreateVertexShader: (_id) => { return save_wasm_object(wasm_object[_id].createShader(wasm_object[_id].VERTEX_SHADER)); },
        glcreateFragmentShader: (_id) => { return save_wasm_object(wasm_object[_id].createShader(wasm_object[_id].FRAGMENT_SHADER)); },
        glshaderSourceCompile: (_id, _shader, _text) => {
            var text = exportObject.getString(_text);
            var gl = wasm_object[_id];
            var shader = wasm_object[_shader];
            gl.shaderSource(shader, text);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                alert('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
                debugger;
            }
        },
        glcreateProgram: (_id) => { return save_wasm_object(wasm_object[_id].createProgram()); },
        glattachShader: (_id, _program, _shader) => { wasm_object[_id].attachShader(wasm_object[_program], wasm_object[_shader]); },
        gldeleteShader: (_id, _shader) => { wasm_object[_id].deleteShader(wasm_object[_shader]); },
        gllinkProgram: (_id, _program) => {
            var shaderProgram = wasm_object[_program];
            var gl = wasm_object[_id];
            gl.linkProgram(shaderProgram);
            if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
                alert('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
                debugger;
            }
        },
        glgetAttribLocation: (_id, _program, _text) => {
            return save_wasm_object(wasm_object[_id].getAttribLocation(wasm_object[_program], exportObject.getString(_text)));
        },
        glgetUniformLocation: (_id, _program, _text) => {
            return save_wasm_object(wasm_object[_id].getUniformLocation(wasm_object[_program], exportObject.getString(_text)));
        },
        glcreateBuffer: (_id) => { return save_wasm_object(wasm_object[_id].createBuffer()); },
        glbindArrayBuffer: (_id, _buffer) => {
            var gl = wasm_object[_id];
            gl.bindBuffer(gl.ARRAY_BUFFER, wasm_object[_buffer]);
        },
        glbufferDataArray: (_id, _begin, _end) => {
            var gl = wasm_object[_id];
            gl.bufferData(gl.ARRAY_BUFFER, exportObject.internal.buffer.slice(_begin, _end), gl.STATIC_DRAW);
        },
        glvertexAttribPointer: (_id, _attr, n) => {
            var gl = wasm_object[_id];
            gl.vertexAttribPointer(wasm_object[_attr], n, gl.FLOAT, false, 0, 0);
        },
        glenableVertexAttribArray: (_id, _attr) => { wasm_object[_id].enableVertexAttribArray(wasm_object[_attr]); },
        gluseProgram: (_id, _program) => {
            wasm_object[_id].useProgram(wasm_object[_program]);
        },
        gluniformMatrix4fv: (_id, _attr, _begin) => {
            wasm_object[_id].uniformMatrix4fv(wasm_object[_attr], false, new Float32Array(exportObject.internal.buffer, _begin, 16));
        },
        gldrawTriangleStrip: (_id, offset, vertexCount) => {
            var gl = wasm_object[_id];
            gl.drawArrays(gl.TRIANGLE_STRIP, offset, vertexCount);
        },
        glenable: (_id, cap) => { wasm_object[_id].enable(cap); },
        gldepthFunc: (_id, cap) => { wasm_object[_id].depthFunc(cap); },
        tan: (x) => Math.tan(x),
        cos: (x) => Math.cos(x),
        sin: (x) => Math.sin(x),
        random: () => Math.random(),
    }
};

function callwasm(id) {
    if (id in wasm_callbacks) {
        var cb = wasm_callbacks[id];
        exportObject.internal.call(cb[0], cb[1]);
    }
}

if (typeof WebAssembly === "object") {
    if (typeof WebAssembly.instantiateStreaming !== "function") {
        WebAssembly.instantiateStreaming = (p, importObject) =>
            p.then(response =>
                response.arrayBuffer()
            ).then(bytes =>
                WebAssembly.instantiate(bytes, importObject)
            );
    }
    var memory = new WebAssembly.Memory({initial:33, maximum:1000});
    importObject.env.memory = memory;
    WebAssembly.instantiateStreaming(fetch('native-opt.wasm'), importObject).then(results => {
        var native = results.instance.exports;
        var buffer = memory.buffer;
        exportObject.internal.malloc = native.malloc;
        exportObject.internal.buffer = buffer;
        exportObject.internal.memory = new Int8Array(buffer);
        exportObject.internal.memory32 = new Int32Array(buffer);
        exportObject.internal.memoryf32 = new Float32Array(buffer);
        exportObject.internal.free = native.free;
        exportObject.internal.call = native.call;
        exportObject.internal.callback = native.callback;
        exportObject.internal.get_callback_buffer = native.get_callback_buffer;
        console.log("loaded");
        native.main();
    });
} else {
    var script = document.createElement('script');
    script.src = 'native.js';
    script.type = 'text/javascript';

    script.onload = function () {
        var buffer = new ArrayBuffer(1024*1024*10);
        var native = instantiate(importObject.env, { 'buffer': buffer });
        exportObject.internal.malloc = native.malloc;
        exportObject.internal.buffer = buffer;
        exportObject.internal.memory = new Int8Array(buffer);
        exportObject.internal.memory32 = new Int32Array(buffer);
        exportObject.internal.memoryf32 = new Float32Array(buffer);
        exportObject.internal.free = native.free;
        exportObject.internal.call = native.call;
        exportObject.internal.callback = native.callback;
        exportObject.internal.get_callback_buffer = native.get_callback_buffer;
        console.log("loaded");
        native.main();
    };

    document.getElementsByTagName('head')[0].appendChild(script);
}
