const { decodePng, encodePng } = require("@lunapaint/png-codec");
const { Image } = require("image-js");
const UPNG = require("upng-js");

const Dirs = {
    NORTH: 1,
    SOUTH: 2,
    EAST: 4,
    WEST: 8,
    SOUTHEAST: 2 | 4,
    SOUTHWEST: 2 | 8,
    NORTHEAST: 1 | 4,
    NORTHWEST: 1 | 8
};

const DirNames = [
    "South",
    "North",
    "East",
    "West",
    "Southeast",
    "Southwest",
    "Northeast",
    "Northwest"
];

class DmiState {
    constructor(name, loop = 0, rewind = false, movement = false, dirs = 1) {
        this.name = name;
        this.loop = loop;
        this.rewind = rewind;
        this.movement = movement;
        this.dirs = dirs;
        this.frames = [];
        this.frames_encoded = [];
        this.delays = [];
        this.hotspots = null;
        this.directional_previews = {};
    }

    static DIR_ORDER = [
        Dirs.SOUTH,
        Dirs.NORTH,
        Dirs.EAST,
        Dirs.WEST,
        Dirs.SOUTHEAST,
        Dirs.SOUTHWEST,
        Dirs.NORTHEAST,
        Dirs.NORTHWEST
    ];

    frame_index(frame = 0, dir) {
        let ofs = DmiState.DIR_ORDER.findIndex(x => x == dir);
        if (ofs >= this.dirs) ofs = 0;
        return frame * this.dirs + ofs;
    }

    get_frame(frame = 0, dir) {
        const index = this.frame_index(frame, dir);
        return this.frames[index];
    }

    get_frame_encoded(frame = 0, dir) {
        const index = this.frame_index(frame, dir);
        return this.frames_encoded[index];
    }

    get framecount() {
        return Math.floor(this.frames.length / this.dirs);
    }

    serialize() {
        const obj = {
            name: this.name,
            loop: this.loop,
            rewind: this.rewind,
            movement: this.movement,
            dirs: this.dirs,
            frames: [],
            frames_encoded: this.frames_encoded,
            delays: this.delays,
            hotspots: this.hotspots
        };
        return obj;
    }

    static async deserialize(state) {
        const new_state = new DmiState(
            state.name,
            state.loop,
            state.rewind,
            state.movement,
            state.dirs
        );
        new_state.delays = state.delays;
        new_state.hotspots = state.hotspots;
        new_state.frames_encoded = state.frames_encoded;
        for (const frame of state.frames_encoded) {
            const test = await Image.load(frame);
            new_state.frames.push(test);
        }
        return new_state;
    }

    clone() {
        const clone = new DmiState(this.name, this.loop, this.rewind, this.movement, this.dirs);
        clone.frames = [...this.frames];
        clone.frames_encoded = [...this.frames_encoded];
        clone.delays = [...this.delays];
        clone.hotspots = this.hotspots;
        return clone;
    }

    set_dirs(new_dircount) {
        const target_frames = this.framecount * new_dircount;
        const width = this.frames[0].width;
        const height = this.frames[0].height;

        this.dirs = new_dircount;

        this.frames = resizeArray(this.frames, target_frames, index =>
            DmiState.empty_frame(width, height)
        );

        this.frames_encoded = resizeArray(this.frames_encoded, target_frames, index =>
            this.frames[index].toDataURL()
        );

        if (this.delays.length) {
            this.delays = resizeArray(this.delays, this.framecount, index => 1);
        }

        if (this.hotspots !== null) {
            const last_hotspot = this.hotspots[this.hotspots.length];
            this.hotspots = resizeArray(this.hotspots, this.framecount, index => last_hotspot);
        }
    }

    set_framecount(new_framecount) {
        const target_frames = new_framecount * this.dirs;
        const width = this.frames[0].width;
        const height = this.frames[0].height;

        this.frames = resizeArray(this.frames, target_frames, index =>
            DmiState.empty_frame(width, height)
        );

        this.frames_encoded = resizeArray(this.frames_encoded, target_frames, index =>
            this.frames[index].toDataURL()
        );

        if (this.delays.length) {
            this.delays = resizeArray(this.delays, this.framecount, index => 1);
        }

        if (this.hotspots !== null) {
            const last_hotspot = this.hotspots[this.hotspots.length];
            this.hotspots = resizeArray(this.hotspots, this.framecount, index => last_hotspot);
        }
    }

    static empty_frame(width, height) {
        const defaultBackground = [192, 192, 192, 0];
        return new Image(width, height, new Array(width * height).fill(defaultBackground).flat(), {
            alpha: 1,
            kind: "RGBA"
        });
    }

    get width() {
        return this.frames[0].width;
    }

    get height() {
        return this.frames[0].height;
    }

    mark_dirty() {
        this.directional_previews = {};
    }

    generate_preview(dir) {
        if (this.directional_previews[dir] == undefined) {
            if (this.framecount == 1) {
                this.directional_previews[dir] = this.get_frame_encoded(0, dir);
            }
            const frame_data = [...Array(this.framecount)].map(
                (_, index) => this.get_frame(index, dir).getRGBAData().buffer
            );
            const dels = this.delays.map(delay => delay * 100);
            const data = UPNG.encode(frame_data, this.width, this.height, 0, dels);
            const blob = new Blob([data], { type: "image/png" });
            this.directional_previews[dir] = window.URL.createObjectURL(blob);
        }
        return this.directional_previews[dir];
    }

    async buildComposite() {
        const output_height = this.dirs * this.height;
        const output_width = this.width * this.framecount;
        const new_image = DmiState.empty_frame(
            output_width,
            output_height
        );
        for (let dir_index = 0; dir_index < this.dirs; dir_index++) {
            const dir = DmiState.DIR_ORDER[dir_index];
            for (let frame_index = 0; frame_index < this.framecount; frame_index++) {
                const frame = this.get_frame(frame_index, dir);
                new_image.insert(frame, {
                    x: frame_index * this.width,
                    y: dir_index * this.width,
                    inPlace: true
                });
            }
        }
        return await new_image.toBlob();
    }
}


class Dmi {
    constructor(width, height, states) {
        this.width = width;
        this.height = height;
        this.states = states ? states : [];
        this.version = "4.0";
    }

    isSame(other) {
        return this.serialize() === other.serialize();
    }

    buildMetadata() {
        let comment = "# BEGIN DMI\n";
        comment += `version = ${Dmi.version}\n`;
        comment += `\twidth = ${this.width}\n`;
        comment += `\theight = ${this.height}\n`;
        for (const state of this.states) {
            comment += `state = ${escape_state_name(state.name)}\n`;
            comment += `\tdirs = ${state.dirs}\n`;
            comment += `\tframes = ${state.framecount}\n`;
            if (state.framecount > 1 && state.delays.length > 0) {
                comment += `\tdelay = ${state.delays.join()}\n`;
            }
            if (state.loop != 0) comment += `\tloop = ${state.loop}\n`;
            if (state.rewind) comment += `\trewind = 1\n`;
            if (state.movement) comment += `\tmovement = 1\n`;
            if (state.hotspots !== null && state.hotspots.length > 0) {
                let previous = null;
                state.hotspots.forEach((value, index) => {
                    if (value === undefined || value === null) return;
                    if (previous === null || previous[0] !== value[0] || previous[1] !== value[1]) {
                        comment += `\thotspot = ${value[0]},${value[1]},${index + 1}\n`;
                        previous = value;
                    }
                });
            }
        }
        comment += "# END DMI\n";
        return comment;
    }

    buildData() {
        const num_frames = this.states
            .map(x => x.frames.length)
            .reduce((prev, current) => prev + current, 0);
        if (num_frames === 0) {
            const blank_image = DmiState.empty_frame(
                this.width,
                this.height
            );
            const data = Uint8Array.from(blank_image.data);
            return { data: data, width: this.width, height: this.height };
        }
        const sqrt = Math.ceil(Math.sqrt(num_frames));
        const png_width = sqrt * this.width;
        const png_height = Math.ceil(num_frames / sqrt) * this.height;
        const result_image = DmiState.empty_frame(png_width, png_height);

        let i = 0;
        for (const state of this.states) {
            for (const frame of state.frames) {
                const frame_x = (i % sqrt) * this.width;
                const frame_y = Math.floor(i / sqrt) * this.height;
                result_image.insert(frame, { x: frame_x, y: frame_y, inPlace: true });
                i++;
            }
        }

        const data = Uint8Array.from(result_image.data);
        return { data: data, width: png_width, height: png_height };
    }

    async getFileData() {
        const metadata = this.buildMetadata();
        const data = this.buildData();
        const result = await encodePng(data, {
            colorType: 6,
            ancillaryChunks: [
                {
                    keyword: "Description",
                    text: metadata,
                    type: "zTXt"
                }
            ]
        });
        return result.data;
    }

    serialize() {
        const obj = {
            width: this.width,
            height: this.height,
            states: this.states.map(x => x.serialize())
        };
        return JSON.stringify(obj);
    }

    clone() {
        const new_dmi = new Dmi(this.width, this.height);
        new_dmi.states = this.states.map(x => x.clone());
        return new_dmi;
    }

    resize(new_width, new_height) {
        this.width = new_width;
        this.height = new_height;
        for (const state of this.states) {
            state.frames = state.frames.map(x =>
                x.resize({ width: new_width, height: new_height })
            );
            state.frames_encoded = state.frames.map(x => x.toDataURL());
        }
    }

    static async parse(data) {
        const decoded = await decodePng(data, { parseChunkTypes: "*" });
        const chunk = decoded.metadata.find(
            p =>
                p !== undefined &&
                p.type === "zTXt" &&
                p.keyword !== undefined &&
                p.keyword === "Description"
        );
        if (chunk === undefined) {
            const png_as_dmi = new Dmi(decoded.image.width, decoded.image.height);
            const image = await Image.load(data);
            const state = new DmiState("png");
            state.dirs = 1;
            state.frames.push(image);
            state.frames_encoded.push(image.toDataURL());
            png_as_dmi.states.push(state);
            return png_as_dmi;
        }
        const zTXtChunk = chunk;
        const metadata = zTXtChunk.text;

        const dmi = new Dmi(32, 32);
        

        const lines = metadata.split("\n");
        if (lines[0] != "# BEGIN DMI") throw Error("Missing metadata header.");
        if (lines[1] != `version = ${dmi.version}`)
            throw Error("Invalid dmi metadata version. Line version is  " + lines[1]);

        let state;
        let temporaryFrameCounts = new Map()
        
        for (const line of lines.slice(2)) {
            if (line === "# END DMI") break;
            const parts = line.trim().split("=");
            const key = parts[0].trim();
            const value = parts[1].trim();
            switch (key) {
                case "width":
                    dmi.width = parseInt(value);
                    break;
                case "height":
                    dmi.height = parseInt(value);
                    break;
                case "state":
                    state = new DmiState(unescape_state_name(value));
                    await dmi.states.push(state);
                    break;
                case "dirs":
                    if(state == undefined) throw Error("state yok bilader")
                    state.dirs = parseInt(value);
                    break;
                case "frames":
                    if(state == undefined) throw Error("state yok bilader")
                    temporaryFrameCounts.set(state, parseInt(value))
                    break;
                case "delay":
                    if(state == undefined) throw Error("state yok bilader")
                    state.delays = value.split(",").map(x => (x.includes(".") ? parseFloat(x) : parseInt(x)));
                    break;
                case "loop":
                    if(state == undefined) throw Error("state yok bilader")
                    state.loop = parseInt(value);
                    break;
                case "rewind":
                    if(state == undefined) throw Error("state yok bilader")
                    state.rewind = parseInt(value) == "1";
                    break;
                case "movement":
                    if(state == undefined) throw Error("state yok bilader")
                    state.movement = parseInt(value) == "1";
                    break;
                case "hotspot":
                    if(state == undefined) throw Error("state yok bilader")
                    
                    const [x, y, first_frame] = value.split(",").map(x => parseInt(x));
                    const framecount = temporaryFrameCounts.get(state);
                    if (framecount == undefined) {
                        throw Error("Out of order state information in metadata.");
                    }
                    if (state.hotspots == null)
                    state.hotspots = new Array(framecount);
                    for (let index = first_frame - 1; index < state.hotspots.length; index++) {
                        state.hotspots[index] = [x, y];
                    }
                    break;
                default:
                    throw new Error("unknown metadata key")
            }
        
        }
        try{
        const image = await Image.load(data);
        const gridwidth = Math.floor(image.width / dmi.width);
        let i = 0;
        for (const state of dmi.states) {
            const framecount = temporaryFrameCounts.get(state);
            if (framecount === undefined) {
                throw new Error("state missing frame count metadata");
            }
            for (let frame = 0; frame < framecount; frame++) {
                for (let dir = 0; dir < state.dirs; dir++) {
                    const px = dmi.width * (i % gridwidth);
                    const py = dmi.height * Math.floor(i / gridwidth);
                    const im = image.crop({ x: px, y: py, width: dmi.width, height: dmi.height }); //image.crop((px, py, px + dmi.width, py + dmi.height))
                    if (im.width !== dmi.width || im.height !== dmi.height)
                        throw new Error("Mismatched size when extracting frames");
                    state.frames.push(im);
                    const dataUrl = im.toDataURL();
                    state.frames_encoded.push(dataUrl);
                    i++;
                }
            }
        }
        } catch(e) {
            console.log(e)
        }
        
        return dmi;
    }
}
function resizeArray(arr, new_size, filler) {
    const len = arr.length;
    if (len < new_size) {
        for (let i = len; i < new_size; i++) {
            arr.push(filler(i));
        }
    } else if (len > new_size) {
        arr.splice(new_size, len - new_size);
    }
    return arr;
}

function escape_state_name(name) {
    return name.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

function unescape_state_name(name) {
    return name.replace(/\\\\/g, "\\").replace(/\\n/g, "\n");
}

module.exports = Dmi