/**
 * Created by Dmitry on 22/08/2016.
 */

module.exports.ERROR = {
	INTERNAL_SERVER_ERROR: 1,
	EVENT_NOT_EXISTS: 1
};

class AppError extends Error {
	constructor(errorCode, description, data = null) {
		if (!errorCode){
			throw new Error('Fail errorCode');
		}

		super();
		this.name = errorCode;
		this.message = description;

		if (data) {
			this.data = data;
		}
	}
}

for (const key in module.exports.ERROR) {
	if (module.exports.ERROR.hasOwnProperty(key)) {
		module.exports.ERROR[key] = key;
	}
}

module.exports.AppError = AppError;
